# VIN History Monitor

Extensao de navegador (Chrome/Edge, Manifest V3) que monitora o campo **VIN**
de um formulario do Google Forms. Toda vez que um valor e inserido nesse
campo, ele e salvo em um historico local com a hora exata do registro. VINs
duplicados sao removidos automaticamente, mantendo sempre o registro mais
recente daquele VIN no topo do historico.

## Funcionalidades

- Detecta automaticamente a pergunta cujo titulo contem "VIN" em qualquer
  formulario aberto em `docs.google.com/forms/*`.
- Salva o valor digitado ao sair do campo, pressionar Enter, trocar de aba ou
  fechar a pagina.
- Historico acessivel pelo popup da extensao, com VIN e horario formatado.
- Remocao automatica de duplicatas: se o mesmo VIN for inserido novamente, a
  entrada antiga e substituida por uma nova com o horario atualizado.
- Botao para limpar todo o historico.

## Instalacao (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactacao" e selecione a pasta `extension/`
   deste repositorio.
4. Abra o formulario do Google Forms que contem o campo VIN e preencha-o.
5. Clique no icone da extensao para ver o historico.

## Estrutura

```
extension/
  manifest.json   # Configuracao da extensao (Manifest V3)
  content.js      # Detecta o campo VIN e grava o historico
  popup.html      # Interface do historico
  popup.js        # Logica do popup (leitura/limpeza do historico)
  popup.css       # Estilos do popup
```

O historico e armazenado localmente via `chrome.storage.local`, sob a chave
`vinHistory`, como uma lista de objetos `{ vin, timestamp }`.
