# VIN History Monitor

Extensao de navegador (Chrome/Edge, Manifest V3) que monitora o campo **VIN**
de um formulario (Google Forms ou Microsoft Forms). Toda vez que um valor e
inserido nesse campo, ele e salvo em um historico local com a hora exata do
registro.

## Funcionalidades

- Detecta automaticamente o campo cujo rotulo contem "VIN" em formularios
  abertos em `docs.google.com/forms/*`, `forms.office.com/*`,
  `forms.microsoft.com/*` ou `forms.cloud.microsoft/*`.
- Salva o valor digitado ao sair do campo, pressionar Enter, trocar de aba ou
  fechar a pagina.
- **Remocao automatica de duplicatas (opcional, desativada por padrao):** no
  popup ha um interruptor "Remover VINs duplicados automaticamente". Enquanto
  desativado, todos os VINs digitados ficam no historico, mesmo repetidos.
  Ao ativar, o historico ja gravado tambem e limpo na hora, mantendo apenas o
  registro mais recente de cada VIN; dai em diante, inserir um VIN ja
  existente substitui a entrada antiga.
- **Remover duplicatas ja registradas:** botao "Remover duplicatas agora" no
  popup e "Remover duplicatas" no calendario, que limpam de uma vez os VINs
  repetidos que ja estao gravados, mantendo apenas o registro mais recente de
  cada um. Ambas as telas mostram quantos registros duplicados existem e
  pedem confirmacao antes de apagar; o botao fica desabilitado quando nao ha
  nada a remover.
- **Comparacao tolerante:** o mesmo VIN escrito com espacos, hifens ou em
  minusculas (`95PEFL31 DVB101832`, `95pefl31dvb101832`) conta como um unico
  VIN, tanto para remover quanto para destacar duplicatas.
- **Turnos configuraveis:** 1º, 2º e 3º turnos, cada um com horario de inicio
  e fim editaveis no popup (padrao 06:00-14:00, 14:00-22:00 e 22:00-06:00).
  O 3º turno atravessa a meia-noite corretamente: um VIN registrado as 23h e
  outro as 02h caem no mesmo turno.
- **Separacao e contagem por turno:** os VINs sao classificados pelo horario
  em que foram registrados. O popup e o calendario mostram o total de VINs de
  cada turno, e o painel de um dia no calendario lista os VINs agrupados por
  turno, com a quantidade de cada um. Registros em horarios nao cobertos por
  nenhum turno aparecem em "Fora de turno", e o popup avisa quando os
  horarios configurados deixam buracos ou se sobrepoem.
- **Destaque de duplicatas:** VINs que aparecem mais de uma vez no historico
  sao destacados (borda/fundo amarelo e etiqueta "duplicado") tanto na lista
  do popup quanto no painel de um dia especifico no calendario.
- **Calendario 2026/2027:** pagina dedicada (aberta pelo botao "Ver
  calendario 2026/2027" no popup) com o calendario completo de 2026 e, assim
  que houver o primeiro registro em 2027, o calendario desse ano tambem passa
  a ser exibido. Cada dia com VINs registrados fica destacado em verde (com a
  quantidade) e em amarelo quando ha algum VIN duplicado naquele dia. Clicar
  em um dia abre um painel lateral com os VINs registrados e o horario de
  cada um.
- **Apagar por dia ou geral:** tanto no popup (campo de data + botao "Apagar
  dia") quanto no calendario (clicar no dia e usar "Apagar VINs deste dia") e
  possivel remover apenas os VINs de uma data especifica. O botao "Apagar
  historico geral" remove tudo de uma vez.
- **Banco de reparos com sugestoes:** o campo "PRINCIPAL REPARO" e
  monitorado; cada reparo digitado e aprendido (ao sair do campo) e guardado
  com a quantidade de usos. Ao digitar, um balao abaixo do campo mostra
  reparos parecidos (ignora acentos/maiusculas e tolera erros de digitacao).
  Clique, ou use as setas + Enter, para preencher o campo. O popup lista os
  reparos aprendidos, permite remover um a um ou apagar o banco, e tambem
  permite **ensinar manualmente**: adicionar um reparo, importar uma lista
  (um por linha) e exportar o banco em `.txt`.
- Contagem de VINs no historico exibida no popup e como badge no icone da
  extensao.

## Instalacao (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactacao" e selecione a pasta `extension/`
   deste repositorio.
4. Abra o formulario do Google Forms que contem o campo VIN e preencha-o.
5. Clique no icone da extensao para ver o historico e as opcoes, ou em "Ver
   calendario 2026/2027" para o calendario por dia.

## Estrutura

```
tools/
  make_icons.py   # Gera os PNGs de extension/icons (sem dependencias)

extension/
  manifest.json   # Configuracao da extensao (Manifest V3)
  icons/          # Icones 16/32/48/128 usados na barra e na loja
  storage.js      # Funcoes compartilhadas de acesso ao chrome.storage.local
  content.js      # Detecta o campo VIN e grava o historico
  repairs.js      # Banco de reparos: aprendizado e busca por similaridade
  repair-suggest.js # Balao de sugestoes no campo PRINCIPAL REPARO
  background.js   # Mantem o badge do icone com a contagem de VINs
  popup.html/js/css   # Popup: configuracoes, historico recente, apagar por dia/geral
  history.html/js/css # Pagina de calendario 2026/2027 e detalhe por dia
```

O historico e armazenado localmente via `chrome.storage.local`:

- `vinHistory`: lista de objetos `{ vin, timestamp }`.
- `vinSettings`: `{ dedupeEnabled: boolean, shifts: [{ id, label, start, end }] }`
  (`dedupeEnabled` padrao `false`; `shifts` com os tres turnos padrao).
- `repairDb`: lista de `{ key, text, count, lastUsed }` (reparos aprendidos).
