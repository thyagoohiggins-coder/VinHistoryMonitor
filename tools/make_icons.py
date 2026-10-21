#!/usr/bin/env python3
"""Gera os icones PNG da extensao.

Sem dependencias externas: o PNG e montado com zlib/struct e o desenho e
feito com supersampling (renderiza grande e reduz), o que da as bordas
suavizadas sem precisar de uma biblioteca grafica.

Uso: python3 tools/make_icons.py
"""

import os
import struct
import zlib

FUNDO = (0, 0, 0)          # fundo preto do icone
BRANCO = (255, 255, 255)

RAIO = 0.22                # canto arredondado, fracao do lado
SUPERSAMPLE = 8

# Letras "F" e "A" desenhadas com retangulos e paralelogramos em coordenadas
# normalizadas (0..1). Os tracos sao grossos para continuarem legiveis a 16px.
LETRAS_Y0, LETRAS_Y1 = 0.25, 0.75

# F: (x0, y0, x1, y1) de cada retangulo.
RETANGULOS_F = [
    (0.1250, 0.25, 0.2500, 0.75),   # haste
    (0.1250, 0.25, 0.4375, 0.35),   # barra de cima
    (0.1250, 0.45, 0.3750, 0.55),   # barra do meio
]

# A: pernas inclinadas (paralelogramos) + travessa.
ESPESSURA_PERNA = 0.10
A_TOPO = (0.6000, 0.7600)           # x inicial/final do topo (ponta)
A_BASE_ESQ = 0.4600                 # x inicial da base da perna esquerda
A_BASE_DIR = 0.8000                 # x inicial da base da perna direita
TRAVESSA_Y = (0.56, 0.64)


def no_retangulo(x, y, ret):
    x0, y0, x1, y1 = ret
    return x0 <= x < x1 and y0 <= y < y1


def na_perna(x, y, topo_x0, base_x0):
    """Paralelogramo entre o topo (y=0.25) e a base (y=0.75)."""
    if not LETRAS_Y0 <= y < LETRAS_Y1:
        return False
    t = (y - LETRAS_Y0) / (LETRAS_Y1 - LETRAS_Y0)
    x0 = topo_x0 + (base_x0 - topo_x0) * t
    return x0 <= x < x0 + ESPESSURA_PERNA


def na_letra(x, y):
    if any(no_retangulo(x, y, ret) for ret in RETANGULOS_F):
        return True
    topo_esq = A_TOPO[0]
    topo_dir = A_TOPO[1] - ESPESSURA_PERNA
    if na_perna(x, y, topo_esq, A_BASE_ESQ) or na_perna(x, y, topo_dir, A_BASE_DIR):
        return True
    if TRAVESSA_Y[0] <= y < TRAVESSA_Y[1]:
        # A travessa vai de uma perna a outra, sem passar do contorno.
        t = (y - LETRAS_Y0) / (LETRAS_Y1 - LETRAS_Y0)
        esq = topo_esq + (A_BASE_ESQ - topo_esq) * t
        dir_ = topo_dir + (A_BASE_DIR - topo_dir) * t + ESPESSURA_PERNA
        return esq <= x < dir_
    return False


TAMANHOS = [16, 32, 48, 128]


def dentro_do_quadrado_arredondado(x, y, raio):
    """Teste de ponto dentro de um retangulo de cantos arredondados."""
    cx = min(max(x, raio), 1.0 - raio)
    cy = min(max(y, raio), 1.0 - raio)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= raio * raio


def cor_do_ponto(x, y):
    """Retorna (r, g, b, a) do ponto normalizado (x, y)."""
    if not dentro_do_quadrado_arredondado(x, y, RAIO):
        return (0, 0, 0, 0)

    if na_letra(x, y):
        return BRANCO + (255,)

    return FUNDO + (255,)


def renderiza(tamanho):
    """Desenha em SUPERSAMPLE vezes o tamanho e reduz por media."""
    grande = tamanho * SUPERSAMPLE

    # Amostra a imagem ampliada uma unica vez.
    amostras = []
    for py in range(grande):
        y = (py + 0.5) / grande
        linha = [cor_do_ponto((px + 0.5) / grande, y) for px in range(grande)]
        amostras.append(linha)

    linhas = []
    for y in range(tamanho):
        linha = bytearray()
        for x in range(tamanho):
            soma_r = soma_g = soma_b = soma_a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    r, g, b, a = amostras[y * SUPERSAMPLE + sy][x * SUPERSAMPLE + sx]
                    # Pre-multiplica pelo alfa para nao escurecer a borda.
                    soma_r += r * a
                    soma_g += g * a
                    soma_b += b * a
                    soma_a += a
            n = SUPERSAMPLE * SUPERSAMPLE
            alfa = soma_a / n
            if soma_a == 0:
                linha += bytes((0, 0, 0, 0))
            else:
                linha += bytes(
                    (
                        round(soma_r / soma_a),
                        round(soma_g / soma_a),
                        round(soma_b / soma_a),
                        round(alfa),
                    )
                )
        linhas.append(bytes(linha))
    return linhas


def grava_png(caminho, tamanho, linhas):
    cru = b"".join(b"\x00" + linha for linha in linhas)  # filtro 0 por linha

    def bloco(tipo, dados):
        return (
            struct.pack(">I", len(dados))
            + tipo
            + dados
            + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)
        )

    cabecalho = struct.pack(">IIBBBBB", tamanho, tamanho, 8, 6, 0, 0, 0)  # RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", cabecalho)
        + bloco(b"IDAT", zlib.compress(cru, 9))
        + bloco(b"IEND", b"")
    )

    with open(caminho, "wb") as arquivo:
        arquivo.write(png)


def main():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    destino = os.path.join(raiz, "extension", "icons")
    os.makedirs(destino, exist_ok=True)

    for tamanho in TAMANHOS:
        caminho = os.path.join(destino, f"icon{tamanho}.png")
        grava_png(caminho, tamanho, renderiza(tamanho))
        print(f"gerado {caminho} ({os.path.getsize(caminho)} bytes)")


if __name__ == "__main__":
    main()
