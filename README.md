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
  as configuracoes tem o interruptor "Remover VINs já lançados repetidos automaticamente". Enquanto
  desativado, todos os VINs digitados ficam no historico, mesmo repetidos.
  Ao ativar, o historico ja gravado tambem e limpo na hora, mantendo apenas o
  registro mais recente de cada VIN; dai em diante, inserir um VIN ja
  existente substitui a entrada antiga.
- **Remover duplicatas ja registradas:** botao "Remover repetidos agora" nas
  configuracoes, que limpa de uma vez os VINs
  repetidos que ja estao gravados, mantendo apenas o registro mais recente de
  cada um. Ambas as telas mostram quantos registros duplicados existem e
  pedem confirmacao antes de apagar; o botao fica desabilitado quando nao ha
  nada a remover.
- **Comparacao tolerante:** o mesmo VIN escrito com espacos, hifens ou em
  minusculas (`95PEFL31 DVB101832`, `95pefl31dvb101832`) conta como um unico
  VIN, tanto para remover quanto para destacar duplicatas.
- **Separacao e contagem por turno:** os VINs sao classificados pelo horario
  em que foram registrados. O popup e a lista mostram o total de VINs de
  cada turno, e a lista agrupa os VINs por turno, com a quantidade de cada um. 
- **Destaque de "Já lançado":** VINs que aparecem mais de uma vez no historico
  sao destacados (borda/fundo amarelo e etiqueta "Já lançado") tanto na lista
  do popup quanto na pagina da lista.
- **Lista de VINs:** pagina dedicada (aberta pelo botao "Ver lista de VINs"
  no popup) com os VINs do dia separados por turno, quantidade de cada turno,
  busca por VIN, destaque de duplicados e botao para apagar cada VIN.
- **Limpeza automatica no fim do 3º turno:** os turnos padrao sao 1º
  06:00-15:48, 2º 15:48-01:00 e 3º 01:00-06:00. Quando o 3º turno termina
  (inicio do 1º turno, 06:00) todos os VINs sao apagados; a lista passa a
  conter so o dia de producao atual. A limpeza roda por alarme da extensao e
  tambem ao abrir o navegador, o popup ou a lista (cobre o navegador fechado
  na virada). Pode ser desligada nas configuracoes ("Apagar VINs ao fim do 3º turno").
  Os horarios dos turnos sao fixos (nao ha opcao de edita-los).
- **Modelo e cor:** ao lado de cada VIN (lista e popup) aparecem etiquetas com
  a opcao marcada nas perguntas "MODELO" e "COR" do formulario, atualizadas
  se voce trocar a resposta depois de o VIN ja ter sido registrado.
- **Principal reparo junto do VIN:** o texto do campo "PRINCIPAL REPARO" fica
  gravado no registro do VIN (aparece como "Reparo: ..." na lista e no popup),
  e e apagado junto com ele na limpeza ao fim do 3º turno. Tambem entra nos
  indicadores, que sao permanentes.
- **Cripple (PEÇAS FALTANTES):** a lista (e o popup) mostram, na frente de cada
  VIN, as opcoes marcadas na pergunta "PEÇAS FALTANTES" do formulario (varias
  ou todas podem estar marcadas; "Outra" mostra o texto digitado). As opcoes
  sao atualizadas conforme voce marca/desmarca, mesmo depois de o VIN ja ter
  sido registrado. Sem nenhuma marcada aparece "Cripple: nenhum".
- **Apagar:** cada VIN tem sua lixeira. "Apagar histórico geral" fica nas
  configuracoes, atras do PIN.
- **Banco de reparos com sugestoes:** o campo "PRINCIPAL REPARO" e
  monitorado; cada reparo digitado e aprendido (ao sair do campo) e guardado
  com a quantidade de usos. Ao digitar, um balao abaixo do campo mostra
  reparos parecidos (ignora acentos/maiusculas e tolera erros de digitacao).
  Clique, ou use as setas + Enter, para preencher o campo. As
  configuracoes listam os reparos aprendidos, permitem remover um a um ou
  apagar o banco e **ensinar manualmente**: adicionar um reparo, importar uma
  lista (um por linha) e exportar o banco em `.txt`. O banco pode ser
  **congelado** (interruptor): congelado, nao aprende nem aceita reparos novos.
- **Popup enxuto:** icone "FA", botao de configuracoes (engrenagem), "Ver lista
  de VINs", "Indicadores de reparos" e os VINs recentes. O total e os VINs por
  turno ficam escondidos atras de "Mostrar resumo".
- **Configuracoes** (`settings.html`): remover repetidos, limpeza ao fim do 3º
  turno, banco de reparos (congelar, adicionar, importar/exportar) e a **area
  protegida por PIN** (padrao `0000`, pode ser alterado ali): "Apagar histórico
  geral", "Apagar indicadores" e troca de PIN. O PIN e uma trava de interface
  (guardado como hash local), nao uma protecao contra quem tem acesso ao
  navegador.
- **Indicadores** (`stats.html`): modelos com mais reparos (barras divididas
  pelas cores dos veiculos), reparos mais frequentes (com o modelo onde mais
  ocorrem) e filtro por periodo (dia de producao, 7 dias, 30 dias, tudo). Os
  dados ficam num registro proprio que **nao e apagado na virada do dia**; cada
  VIN conta uma vez (o registro mais recente).
- O icone da extensao e "FA" em fundo preto, sem numero de contagem.

## Instalacao (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactacao" e selecione a pasta `extension/`
   deste repositorio.
4. Abra o formulario do Google Forms que contem o campo VIN e preencha-o.
5. Clique no icone da extensao para ver o historico e as opcoes, ou em "Ver lista de VINs" para ver os VINs por turno.

## Estrutura

```
tools/
  make_icons.py   # Gera os PNGs de extension/icons (sem dependencias)

extension/
  manifest.json   # Configuracao da extensao (Manifest V3)
  icons/          # Icones 16/32/48/128 usados na barra e na loja
  storage.js      # Funcoes compartilhadas de acesso ao chrome.storage.local
  missing-parts.js # Le as opcoes marcadas de PEÇAS FALTANTES (cripple)
  content.js      # Detecta o campo VIN e grava o historico
  repairs.js      # Banco de reparos: aprendizado e busca por similaridade
  repair-suggest.js # Balao de sugestoes no campo PRINCIPAL REPARO
  background.js   # Alarme da limpeza diaria dos VINs (fim do 3º turno)
  popup.html/js/css   # Popup enxuto: atalhos e VINs recentes
  settings.html/js/css # Configuracoes, banco de reparos e area com PIN
  stats.html/js/css   # Indicadores de reparos por modelo/cor
  history.html/js/css # Pagina com a lista de VINs por turno
```

O historico e armazenado localmente via `chrome.storage.local`:

- `vinHistory`: lista de objetos `{ vin, timestamp, model?, color?, repair?, parts? }`.
- `vinStats`: `{ ts, vin, model, color, repair }` por VIN (indicadores, permanente).
- `vinPinHash`: hash do PIN (padrao 0000 quando ausente).
- `vinSettings`: `{ dedupeEnabled: boolean, autoPurgeEnabled: boolean, repairFrozen: boolean, shifts: [{ id, label, start, end }] }`
  (`dedupeEnabled` padrao `false`; `shifts` com os tres turnos padrao).
- `repairDb`: lista de `{ key, text, count, lastUsed }` (reparos aprendidos).
