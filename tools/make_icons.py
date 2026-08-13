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

VERDE = (11, 128, 67)      # #0b8043, o mesmo verde usado na interface
BRANCO = (255, 255, 255)

RAIO = 0.22                # canto arredondado, fracao do lado
SUPERSAMPLE = 8

# Faixa ocupada pelo "codigo de barras" dentro do quadrado. As fracoes sao
# escolhidas para cair exatamente na grade de pixels em todos os tamanhos
# gerados (3/16, 13/16, 1/4, 3/4); sem isso a ultima barra fica a meio pixel
# e sai borrada a 16px.
BARRAS_X0, BARRAS_X1 = 0.1875, 0.8125
BARRAS_Y0, BARRAS_Y1 = 0.25, 0.75

# (e_barra, peso) - larguras irregulares para que o desenho seja lido como
# codigo de barras, e nao como um menu. Os pesos somam 10, e a faixa mede
# 10px a 16px, entao cada unidade vale exatamente 1px (2px a 32, 3px a 48,
# 8px a 128) e todas as barras saem nitidas.
SEGMENTOS = [(1, 3), (0, 1), (1, 1), (0, 1), (1, 2), (0, 1), (1, 1)]

TAMANHOS = [16, 32, 48, 128]


def dentro_do_quadrado_arredondado(x, y, raio):
    """Teste de ponto dentro de um retangulo de cantos arredondados."""
    cx = min(max(x, raio), 1.0 - raio)
    cy = min(max(y, raio), 1.0 - raio)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= raio * raio


def faixas_das_barras():
    """Converte SEGMENTOS em intervalos [inicio, fim] normalizados."""
    total = sum(peso for _, peso in SEGMENTOS)
    largura = BARRAS_X1 - BARRAS_X0

    faixas = []
    cursor = 0
    for e_barra, peso in SEGMENTOS:
        inicio = BARRAS_X0 + (cursor / total) * largura
        fim = BARRAS_X0 + ((cursor + peso) / total) * largura
        if e_barra:
            faixas.append((inicio, fim))
        cursor += peso
    return faixas


def cor_do_ponto(x, y, faixas):
    """Retorna (r, g, b, a) do ponto normalizado (x, y)."""
    if not dentro_do_quadrado_arredondado(x, y, RAIO):
        return (0, 0, 0, 0)

    if BARRAS_Y0 <= y <= BARRAS_Y1:
        for inicio, fim in faixas:
            if inicio <= x < fim:
                return BRANCO + (255,)

    return VERDE + (255,)


def renderiza(tamanho):
    """Desenha em SUPERSAMPLE vezes o tamanho e reduz por media."""
    faixas = faixas_das_barras()
    grande = tamanho * SUPERSAMPLE

    # Amostra a imagem ampliada uma unica vez.
    amostras = []
    for py in range(grande):
        y = (py + 0.5) / grande
        linha = [cor_do_ponto((px + 0.5) / grande, y, faixas) for px in range(grande)]
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
