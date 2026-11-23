"""Carga dirigida pelo mapa (F4 L5 a L8): qualquer tabela carregável do mapa, sem código por tabela.

Entrada: o mapa da execução (`mapa.carregar_execucao`): `tabelas.tsv` (destinos, chave, ordem), `colunas.tsv` (regra,
referência e de-para gerados por nome e tipo), `declarado/colunas.tsv` + `declarado/colunas.d/*.tsv` (as colunas
APROVEITADAS, com o destino `tabela.coluna`; regra e de-para declarados valem por cima dos gerados) e
`dependencias.tsv` (arestas em duas fases). Só entra a tabela que tem ao menos uma coluna declarada com destino; as do
L3 (`carga.ORDEM`) seguem na carga própria (`carga.py`).

Mesmas garantias do L3 (herda `carga.Carga`):
- toda linha lida fica em `conector_origem` (hash dos bytes crus das colunas lidas); recusa com regra e gravidade,
  pendência no mesmo commit; SAVEPOINT por linha (restrição do destino recusa só a linha: `restricao_destino_<código>`);
- cadastro provisório do L3 (fonte pagadora criada pelo atendimento, `PROVISORIO`): a linha real o completa (UPDATE do
  mesmo id), sem virar alteração; recusada, o provisório fica como estava, com a regra;
- linha igual é pulada; alterada na origem fica com `alteracao_aguarda_sincronizar` (hash guardado intocado); apagada
  na origem, `apagada_aguarda_sincronizar`; diferente no destino com rastro de edição, `edicao_no_destino`;
- regra de coluna (`sentinela.aplicar`): a pendência da regra vai para a linha (data_sentinela, hora_sem_data,
  valor_fora_do_dominio...), o valor vira NULL; de-para oficial (`depara.Depara`): código ausente ou inválido vira
  pendência `catalogo_codigo_*` (catálogo oficial nunca é criado nem gravado);
- referência (`chave_origem` com `referencia`): id de destino do pai pelo `conector_origem`. Pai recusado ou pendente:
  a linha é recusada com `pai_pendente` (gravidade e raiz da cadeia pelo `pendencia.Propagador`); pai nunca visto:
  NULL com pendência `pai_inexistente` (coluna NOT NULL no destino recusa a linha pela restrição). Autorreferência e
  aresta declarada em duas fases (`declarado/ciclos.tsv`): a linha entra com NULL e a referência é gravada no fim
  (fase 2), por UPDATE;
- colunas especiais (L5): `=<texto>` literal convertido ao tipo do destino; `=~<texto>` literal PRESUMIDO (grava e
  deixa por linha a pendência baixa `valor_presumido`, para o cliente revisar); `@estabelecimento` id do único
  estabelecimento do cliente (nenhum ou vários: recusa com `estabelecimento_indefinido`; com coluna de unidade na
  origem, use a referência declarada); `#seq:<COLUNA>` 1..n dentro do mesmo valor da coluna, na ordem da chave
  (contada em toda leitura, estável no diferencial);
- referência declarada no campo `via` (`ref:<TABELA>`, ex.: login do usuário pela chave do pai), por cima da gerada;
- de-para de valores próprio (`depara=valores`, pares em `declarado/valores.tsv` por tabela, coluna e destino):
  aplicado depois da regra; valor sem par vira NULL com `valor_fora_do_dominio`;
- código `codigo_char` gravado em coluna de chave única do destino sem distinção de caixa: os grupos que só diferem
  pela caixa (`sentinela.colisoes_caixa`) são recusados TODOS com `codigo_colisao_caixa` antes de gravar (nenhum
  vence pela ordem de leitura);
- valor da origem convertido ao tipo do destino antes da soma de controle (inteiro gravado em texto entra como
  texto, literal numérico entra como número);
- vários destinos por tabela: o primeiro destino declarado (na ordem de `tabelas_destino`) é o principal; cada um
  dos outros é uma entidade com chave `<chave>/<tabela destino>` em `conector_origem`; `@id` liga ao principal;
- coluna `origem` do destino, se existir e não for declarada, recebe 'migracao'; `criado_em` vem do relógio do banco;
  valor nulo em coluna NOT NULL com padrão no destino fica com o padrão (contado em `padrao_do_destino`; o resumo usa
  o valor relido do banco);
- conciliação por entidade (tabela de destino): contagem lida = gravada (relida do banco) + recusada e soma de
  controle do resumo dos campos gravados (texto em bytes CP1252, decimal normalizado, data e hora na precisão do
  destino), calculada da origem convertida e relida do destino. A coluna em duas fases fica fora do resumo.
- mede linhas por segundo por tabela (`carga.por_tabela`). Só contagens e regras saem daqui, nunca valores.

Mecanismos genéricos da cobertura total (F4, rodada de cobertura; prova em `sintetica_d/exemplo_cob.py`):
- referência declarada por chave composta `ref:T(C1,C2)`, por chave alternativa `ref:T.K` e encadeada `ref:T>X>U`
  (`mapa.passos_ref`): a origem do pai é lida só nas colunas da chave e das usadas (cache por execução); valor
  repetido na chave alternativa vira `pai_ambiguo`;
- `=@data_carga` (data UTC da carga; `=~@data_carga`, presumida) e `@vigencia_carga` (vigência sem fonte = data da
  carga com a pendência baixa `vigencia_sem_fonte`); estáveis no diferencial (a linha igual é pulada);
- `#sha256:<COLUNA>` (SHA-256 hex do texto convertido), `#codigo_derivado:<COLUNA>:<n>[:<prefixo>]` (prefixo de domínio + valor se couber em n; senão
  prefixo + '~' + 8 hex do SHA-256, pendência baixa `codigo_derivado`) e `#cofre:<COLUNA>` (segredo NUNCA gravado em
  claro: o conector não tem cofre; o destino fica NULL e a linha com segredo leva `segredo_aguarda_cofre`, para o
  cliente cadastrar a credencial no cofre do produto);
- `#data:<ANO>,<MES>[,<DIA>]`: data composta de colunas numéricas (competência: dia 1 se não houver DIA); data
  inválida vira NULL com valor_fora_do_dominio;
- `#retrato`: JSON (chaves em ordem) das colunas lidas da linha, convertidas pela regra declarada ou gerada, sem as
  colunas de segredo (`#cofre`); data em ISO, decimal e número como texto, binário como SHA-256 (histórico da origem
  guardado como retrato da versão);
- opções do destino na `via` de uma coluna dele: `opcional` (destino secundário sem nenhum valor da origem não
  grava linha), `adotar:<c1>,<c2>` (rodada 6: com `adotar_maior:<c>` a coluna adotada guarda o maior, e combina com `agrupar:`
  no principal) (linha que já existe no destino com as mesmas colunas, ex.: CPF ou código, é
  ADOTADA: o conector_origem aponta para ela, nada é sobrescrito, pendência baixa `adotado_existente`; o resumo é o
  relido do destino) e `desdobrar:<COL>=<rótulo>,...` (uma linha do destino por coluna da origem com valor: `#item`
  recebe o valor pela regra declarada nele e `#rotulo` o rótulo; falso ou vazio não gera linha) e `complementa`
  (a tabela COMPLETA a linha que o pai já gravou: a coluna com `ref:` e destino `<tabela>.id` acha a linha, e as
  outras colunas são gravadas nela por UPDATE, sem linha nova; pai não carregado recusa com `pai_inexistente`);
- dependências declaradas (`declarado/dependencias.tsv`) entram na ordem do gerador do mapa.

Mecanismos da rodada 2 de cobertura (prova em `sintetica_d/exemplo_r2.py`):
- `cod:<tabela>.<coluna>` na `via`: o valor da coluna (depois da regra e do de-para de valores) ou o literal (`=x`,
  `=~x`) é procurado em `<tabela>.<coluna>` do DESTINO (cadastro do produto ou já carregado) e grava o id; ausente:
  NULL com `codigo_inexistente_destino`; mais de uma linha: NULL com `pai_ambiguo` (coluna NOT NULL recusa a linha);
- `@unico:<tabela>`: id da única linha ativa (`ativo`, se houver; `excluido_em` nulo, se houver) da tabela do
  destino (cadastro sem fonte na origem); nenhuma ou várias: recusa com `cadastro_unico_indefinido` (alta);
- referência por chave alternativa COMPOSTA `ref:T.(K1,K2)=(C1,C2)` e ao destino SECUNDÁRIO do pai `ref:T/<destino>`
  (`mapa.passos_ref`);
- `#data_hora:<COLUNA_DATA>,<COLUNA_HORA>`: data e hora de duas colunas (data pela regra `data`; hora HHMM em inteiro
  ou texto, TIME ou TIMESTAMP de só hora); sem data: NULL (data sentinela: data_sentinela); sem hora: meia-noite; hora
  inválida: NULL com hora_invalida;
- opção de destino `antes` (secundário gravado ANTES do principal; com `adotar:` cria uma vez e adota depois) e
  especial `@id:<destino>` (o id da linha gravada ou adotada nesse secundário, ex.: a pessoa física do profissional
  criada pelo nome e CPF da própria linha);
- data da origem em coluna DATETIME do destino vira data e hora à meia-noite (e data e hora em coluna DATE, a data), e
  o literal em coluna TIME/DATE/DATETIME vira hora/data antes de gravar e da soma de controle (`tipar`; inválido: NULL
  com valor_fora_do_dominio); regras `minutos_hhmm` e `email`; `hora_hhmm` aceita o texto cru da origem.

Mecanismos da rodada 3 de cobertura, regras de data e hora (prova em `sintetica_d/exemplo_r3.py`):
- `#data_hora:<DATA>,<HORA>,<HORA_REF>`: com a terceira coluna (a hora de início da mesma data), a hora menor que a
  de referência passa para o dia seguinte (virada da meia-noite, pendência baixa `virada_de_dia`);
- `#dias:<VALOR>,<UNIDADE>` (ou `#dias:<VALOR>,=<unidade>`): quantidade com a unidade em outra coluna vira dias
  inteiros (`sentinela.periodo_em_dias`: minuto, hora, dia, semana, mes = 30, ano = 365; mês, ano e fração truncada
  com `periodo_aproximado`, baixa). A unidade pode vir do pai (`ref:T>COLUNA` na via, terminada em coluna) e passar
  pelo de-para de valores da linha (`depara=valores`: valor da origem -> unidade canônica); a regra declarada na
  linha vale para o VALOR antes da conta (ex.: `inteiro_zero_nulo`). Sem unidade: NULL com `unidade_ausente`;
- regras de recorrência `ano_recorrente:<ano>`, `data_nao_recorrente:<ano>`, `dia_recorrente:<ano>` e
  `mes_recorrente:<ano>` (a mesma coluna de data declarada para vários destinos: data repetida todo ano pelo ano-marca);
- `desdobrar` em PARES e no destino PRINCIPAL: `desdobrar:A_INI+A_FIM=2|0,...` gera uma linha por item com `#item`
  (1ª coluna), `#item2` (2ª)... e `#rotulo`, `#rotulo2`... (partes do rótulo separadas por '|'; parte vazia = NULL);
  item sem valor em nenhuma das colunas não gera linha. No principal, cada item fica no conector_origem como
  `<chave>/<destino>/<rótulo>` e a linha como `<chave>` (id do primeiro item); a conciliação confere as linhas
  (lidas = com item + recusadas) e os itens (soma de controle por item); linha sem nenhum item é recusada com a
  pendência baixa `sem_item_a_gravar`. Uma restrição do destino num item recusa a linha inteira (SAVEPOINT da linha).

Mecanismos da rodada 3 de cobertura, regras de estrutura (prova em `sintetica_d/exemplo_r3b.py`):
- retrato COMPLETO da linha (histórico HT*): `#retrato:*` (todas as colunas da tabela da origem, lidas também para o
  hash da linha; sem segredo: colunas de `#cofre` e nomes de segredo, `mapa.SEGREDO_NOME`), `#retrato:*-A,B` (todas
  menos A e B), `#retrato:A,B` (as lidas mais A e B); `#sha256:#retrato[...]`: SHA-256 hex do MESMO texto JSON
  gravado (o produto deduplica versões pelo hash dos dados). Coluna sem regra gerada: BLOB binário em SHA-256, o
  resto como texto;
- referência ao destino secundário do pai e colunas CONCORRENTES: várias colunas da origem declaradas para a mesma
  coluna do destino (ex.: o item faturável pelo procedimento, pela diária ou pelo material, `ref:T/<destino>` em
  cada uma) gravam a PRIMEIRA com valor, na ordem declarada (as outras só deixam a pendência que tiverem);
- cópia de coluna de outra tabela: `ref:T@<coluna>` (ou `ref:T/<destino>@<coluna>`, também no fim da encadeada)
  grava o valor da coluna da linha do DESTINO que o pai gravou (lida do banco, o que o cliente vê), não o id; pai
  pendente ou inexistente como na referência comum;
- divisão do destino principal com o item FALSO: opção `com_falso` no `desdobrar` (o 'N' de uma marcação S/N também
  gera a linha, ex.: herda = falso; vazio continua sem linha);
- agrupamento de linhas sob um cabeçalho (parcelas de um título): opção `antes;agrupar:C1,C2` num destino
  SECUNDÁRIO: as linhas da origem com os mesmos valores em C1, C2 (todas vazias: a linha é o próprio grupo) gravam UM
  cabeçalho (a primeira linha gravada do grupo o cria, as outras o usam, sem pendência) e o principal liga a ele por
  `@id:<destino>`. Agregados do grupo, de todas as linhas lidas do grupo: `#grupo_contar`, `#grupo_seq` (posição da
  linha no grupo, na ordem da chave), `#grupo_somar:C`, `#grupo_min:C`, `#grupo_max:C` (pela regra declarada na
  linha especial, ou a gerada da coluna). Cabeçalho de execução anterior cujos agregados mudaram (parcela nova na
  origem): usado como está, com a pendência `grupo_divergente_aguarda_sincronizar` (a origem vence no Sincronizar).

Mecanismos da rodada 4 de cobertura (pedidos das fatias; prova em `sintetica_d/exemplo_r4.py`):
- `#data_hora_mais:<DATA>,<HORA>,<MINUTOS>`: data + hora HHMM somadas da duração (pela regra declarada na linha, ex.
  `minutos_hhmm`); sem duração na linha, a de outra tabela pela `ref:` da via (encadeada terminada em coluna, ou
  `ref:T.(..)=(..)@coluna`, a que o pai gravou no destino); sem nenhuma: NULL com `duracao_ausente`; fim no dia
  seguinte: pendência baixa `virada_de_dia`;
- condições (`mapa.condicao`): `se:COL[>T>X][=v1,v2][@cod:tab.col]` na via de uma coluna (fora: NULL sem pendência; a próxima
  concorrente é tentada), `destino_se:...` num destino SECUNDÁRIO (fora: o destino não grava, como `opcional`) e
  `so_se:...[!regra]` na tabela (linha fora do filtro: recusada com a pendência BAIXA da regra, nunca gravada; ex.:
  item de referência comercial sem licença do cliente);
- `cod:<tabela>.(c1,c2)=(v1,v2)`: id do destino por chave composta (cada v: `valor` ou literal `=x`);
- `#item`/`#item2` com `ref:` encadeada ou composta e `cod:`; `#rotulo` com `cod:` (o rótulo acha o id no destino);
- `agrupar:C1,..` no destino PRINCIPAL (uma linha do destino por grupo; os membros apontam para ela) e
  `#grupo_json:C1,C2` (lista JSON das colunas de todas as linhas lidas do grupo, sem segredo);
- grupos de leitura sem cabeçalho: `#grupo_seq@C1,C2` (posição na leitura pela chave; `#grupo_seq@*`: na tabela
  inteira, rodada 6) e `#grupo_razao:V@C1,C2`
  (V / soma de V do grupo x 100, na escala do destino; soma zero: NULL com valor_fora_do_dominio);
- agregados das tabelas FILHAS da origem: `#filhos_min|max|somar|contar:T1.C1|T2.C2@FK` (linhas de T com FK = chave
  desta linha; min/max sem valor: NULL com `sem_filho_com_valor`; somar sem filho: 0);
- `#codigo_derivado:C1+C2:<n>[:prefixo]` (valores unidos por '_');
- referência: literal na chave alternativa composta, `max:`/`min:` (escolha entre vários pais, pendência baixa
  `escolha_pelo_maior`/`escolha_pelo_menor`), chave composta num passo seguinte `>(C1,C2)>U`, e vários pais da chave
  alternativa que apontam para a MESMA linha do destino (parcelas do mesmo título agrupado) não são `pai_ambiguo`.

Resíduo do motor da rodada 4 (pedidos que ainda bloqueavam tabelas; prova em `sintetica_d/exemplo_r4b.py`):
- `=@data_carga` (e `=~@data_carga`) com regra declarada na linha: a regra vale para a data da carga (ex.:
  `data_primeiro_dia_mes` = competência do mês da carga; estável no diferencial dentro do mês);
- `#dif:A,B` (A - B) e `#soma:A,B,..`: aritmética entre colunas da linha (nulo = 0; todas nulas: NULL; texto não
  numérico: NULL com valor_fora_do_dominio); a regra declarada vale para o RESULTADO (ex.: `piso:0`);
- opção de coluna `exige_dominio` (com `depara=valores`): valor sem par recusa a linha (valor_fora_do_dominio) em vez
  de cair no padrão do destino;
- opção de coluna `senao`: concorrente que preenche o destino apaga a pendência valor_fora_do_dominio das
  declarações anteriores da mesma coluna (o valor certo veio por outro caminho);
- literal presumido `=~x` em coluna concorrente: a pendência valor_presumido só quando o literal é o valor gravado
  (opção de coluna `marca`: em toda linha, para o aviso deliberado, ex. hora local sem UTC);
- opção de coluna `presumida` numa concorrente que não é literal (ex.: `ref:...;se:...`): quando é ELA que grava o
  valor (estimado por outro caminho), a linha deixa a pendência baixa valor_presumido, como o `=~x` (C10 revisado);
- opção `por_pai` na via de uma coluna do destino PRINCIPAL com `ref:T.K` (ou `ref:T.(K1,K2)=(C1,C2)`): a chave
  alternativa repetida (a mesma pergunta em vários modelos) grava UMA linha do destino POR PAI (item `<chave>/<dt>/<chave
  do pai>`, conciliado como o desdobrado); pai pendente recusa a linha (`pai_pendente`), nenhum pai: `pai_inexistente`.

O hash da linha cobre as colunas lidas (chave + declaradas): declarar uma coluna nova numa tabela já carregada faz as
linhas aparecerem como alteradas (ficam para o Sincronizar), nunca regravadas em silêncio.
"""
import datetime
import decimal
import hashlib
import re
import os
import json
import time

import pymysql

from . import sincronizar as sincronizar_mod
from . import carga, continuidade, depara, mapa, paralelo, sentinela
from .carga import AGORA, ErroCarga, chave_txt, soma
from .leitor import hash_linha
from .pendencia import Propagador
from .texto import texto_para_cp1252

VERSAO = "mapa-2026-11-21"
LOTE_COMMIT = 2000
GRAVIDADE_REGRA = {"valor_presumido": "baixa", "codigo_colisao_caixa": "media", "estabelecimento_indefinido": "alta",
                   "data_sentinela": "baixa", "hora_com_data": "baixa", "hora_sem_data": "media",
                   "valor_fora_do_dominio": "media", "hora_invalida": "media", "catalogo_codigo_inexistente": "media",
                   "catalogo_codigo_invalido": "media", "pai_inexistente": "media"}
GRAVIDADE_REGRA.update({"valor_elevado_ao_minimo": "baixa", "texto_resumido": "baixa", "codigo_derivado": "baixa",
                        "segredo_aguarda_cofre": "media", "adotado_existente": "baixa", "vigencia_sem_fonte": "baixa",
                        "pai_ambiguo": "media", "documento_invalido": "media"})
GRAVIDADE_REGRA.update({"codigo_inexistente_destino": "media", "cadastro_unico_indefinido": "alta"})
GRAVIDADE_REGRA.update({"adocao_por_valor_presumido": "alta"})
GRAVIDADE_REGRA.update({"idade_sem_limite": "baixa"})
GRAVIDADE_REGRA.update({"periodo_aproximado": "baixa", "unidade_ausente": "media", "virada_de_dia": "baixa",
                        "sem_item_a_gravar": "baixa"})
GRAVIDADE_REGRA.update({"grupo_divergente_aguarda_sincronizar": "media"})
GRAVIDADE_REGRA.update({"armazenamento_indefinido": "alta", "arquivo_divergente_no_armazenamento": "alta"})
GRAVIDADE_REGRA.update({"duracao_ausente": "media", "escolha_pelo_maior": "baixa", "escolha_pelo_menor": "baixa",
                        "sem_filho_com_valor": "media", "fora_do_filtro_da_carga": "baixa"})
GRAVIDADE_REGRA.update({"rascunho_sem_autor": "alta", "espelho_codigo_inexistente": "media",
                        "espelho_edicao_inexistente": "media", "espelho_ambiguo": "media",
                        "senha_hash_invalido": "media", "senha_aguarda_argon2": "media",
                        "vigencia_pelo_registro_mais_antigo": "baixa", "vigencia_pela_origem": "baixa",
                        "vigencia_sem_evidencia": "media", "mescla_conflito_origem_guardada": "baixa",
                        "prova_nao_conferida": "alta", "filho_pai_divergente": "alta"})
FILTRO_PADRAO = "fora_do_filtro_da_carga"
# destino de vigência: `@vigencia_carga` e `=@data_carga` nela valem pela EVIDÊNCIA (ADR 0007, item 16)
_DESTINO_VIGENCIA = re.compile(r"vigencia|vigente")
TIPOS_INT = (7, 8, 16)
INT_DESTINO = {"tinyint", "smallint", "mediumint", "int", "bigint"}
DEC_DESTINO = {"decimal"}
TXT_DESTINO = {"char", "varchar", "text", "tinytext", "mediumtext", "longtext"}


# cadastro provisório do L3 (carga._provisorio): tabela da origem -> tabela do destino do provisório. Só é completado
# pela linha real quando o destino principal declarado é o mesmo (TBCBOPRO cria profissional, mas carrega inscrição)
PROVISORIO = {"TBCONVEN": "fonte_pagadora", "TBCBOPRO": "profissional"}


class _Sentinela:
    """Marca única que volta a ser ELA MESMA depois de passar por pickle (estado juntado dos gravadores)."""
    def __init__(self, nome):
        self.nome = nome

    def __reduce__(self):
        return self.nome


_AMBIGUO = _Sentinela("_AMBIGUO")          # valor repetido na chave alternativa do pai (`ref:T.K`)
# texto não numérico em coluna numérica do destino (L6-06): o chamador grava NULL com valor_fora_do_dominio
NAO_NUMERICO = _Sentinela("NAO_NUMERICO")


def tipar(x, tipo):
    """Valor no tipo da coluna de destino (o que o banco devolve na releitura): literal numérico em coluna numérica
    vira número; inteiro ou decimal em coluna de texto vira texto. Sem tipo conhecido, fica como está."""
    if x is None or tipo is None or isinstance(x, bool):
        return x
    if isinstance(x, str) and tipo in ("time", "date", "datetime", "timestamp"):  # literal (`=~23:59:59`)
        try:
            if tipo == "time":
                return datetime.time.fromisoformat(x.strip())
            if tipo == "date":
                return datetime.date.fromisoformat(x.strip())
            return datetime.datetime.fromisoformat(x.strip())
        except ValueError:
            return NAO_NUMERICO
    if tipo in ("datetime", "timestamp") and type(x) is datetime.date:
        return datetime.datetime.combine(x, datetime.time())
    if tipo == "date" and isinstance(x, datetime.datetime):
        return x.date()
    if tipo in INT_DESTINO and isinstance(x, str):
        try:
            return int(x.strip())
        except ValueError:
            return NAO_NUMERICO
    if tipo in DEC_DESTINO and isinstance(x, (str, int, float)):
        try:
            return decimal.Decimal(str(x).strip())
        except decimal.InvalidOperation:
            return NAO_NUMERICO
    if tipo in TXT_DESTINO and isinstance(x, (int, decimal.Decimal)):
        return str(x)
    return x


_ASSINATURAS = ((b"%PDF", "application/pdf", ".pdf"), (b"\x89PNG", "image/png", ".png"),
                (b"\xff\xd8\xff", "image/jpeg", ".jpg"), (b"GIF8", "image/gif", ".gif"),
                (b"BM", "image/bmp", ".bmp"), (b"II*\x00", "image/tiff", ".tif"), (b"MM\x00*", "image/tiff", ".tif"),
                (b"PK\x03\x04", "application/zip", ".zip"), (b"{\\rtf", "application/rtf", ".rtf"))


def _tipo_arquivo(v):
    """Tipo (MIME, extensão) pelos primeiros bytes do binário; desconhecido: application/octet-stream."""
    for ass, mime, ext in _ASSINATURAS:
        if v.startswith(ass):
            return mime, ext
    return "application/octet-stream", ".bin"


def _especial(nome):
    return nome[:1] in ("=", "@", "#")


def fonte_especial(nome):
    """Coluna da origem lida por uma coluna especial (`#seq:X`, `#sha256:X`, `#cofre:X`, `#codigo_derivado:X:n`,
    `#grupo_somar:X`, `#grupo_min:X`, `#grupo_max:X`). `#sha256:#retrato...` não lê coluna própria."""
    if nome.startswith("#sha256:#"):
        return None
    for pre in ("#seq:", "#sha256:", "#cofre:", "#codigo_derivado:", "#grupo_somar:", "#grupo_min:", "#grupo_max:",
                "#arquivo:", "#senha:", "#senha_hash:"):
        if nome.startswith(pre):
            return nome[len(pre):].split(":")[0]
    return None


def fontes_especial(nome):
    """Todas as colunas da origem lidas por uma coluna especial (rodada 4: várias em `#codigo_derivado:A+B:n`,
    `#grupo_json:A,B`, `#grupo_seq@A,B`, `#grupo_razao:V@A,B` e `#data_hora_mais:D,H,M`)."""
    if nome.startswith("#codigo_derivado:"):
        return nome.split(":")[1].split("+")
    if nome.startswith("#grupo_json:"):
        return nome[12:].split(",")
    if nome.startswith("#grupo_seq@"):
        return [x for x in nome[11:].split(",") if x != "*"]
    if nome.startswith("#grupo_razao:"):
        v, cols = nome[13:].split("@", 1)
        return [v] + cols.split(",")
    if nome.startswith("#data_hora_mais:"):
        return nome[16:].split(",")
    if nome.startswith("#dif:") or nome.startswith("#soma:"):
        return nome.split(":", 1)[1].split(",")
    x = fonte_especial(nome)
    return [x] if x else []


def _valor_json(x):
    if isinstance(x, (bytes, bytearray)):
        return "sha256:" + hashlib.sha256(x).hexdigest()
    if isinstance(x, (datetime.date, datetime.time)):
        return x.isoformat()
    if isinstance(x, (decimal.Decimal, float)):
        return canon(decimal.Decimal(str(x)))
    return x


def _ord_chave(cp):
    """Ordem natural de uma chave da origem ('2' antes de '10')."""
    return tuple((0, int(x), "") if x.isdigit() else (1, 0, x) for x in cp.split("|"))


def data_composta(ano, mes, dia=1):
    """(data, pendência) de colunas numéricas; vazio/zero: (None, None); inválida: (None, valor_fora_do_dominio)."""
    try:
        if ano in (None, 0, "") or mes in (None, 0, ""):
            return None, None
        return datetime.date(int(str(ano).strip()), int(str(mes).strip()), int(str(dia or 1).strip())), None
    except (TypeError, ValueError):
        return None, "valor_fora_do_dominio"


def data_hora_composta(data, hora, hora_ref=None, com_ref=False):
    """(data e hora, pendência) de uma coluna de data e outra de hora (`#data_hora:D,H`). Com `com_ref` (`#data_hora:
    D,H,R`), a hora MENOR que a hora de referência R válida (início na mesma data) cai no dia seguinte, com a
    pendência baixa virada_de_dia."""
    x, pr = _data_hora(data, hora)
    if x is None or not com_ref or not _tem_hora(hora):
        return x, pr
    r, prr = _data_hora(data, hora_ref)
    if r is None or prr or not _tem_hora(hora_ref) or x >= r:
        return x, pr
    return x + datetime.timedelta(days=1), "virada_de_dia"


def _tem_hora(h):
    return h is not None and not (isinstance(h, (str, bytes, bytearray)) and not sentinela.aplicar("texto", h)[0])


def _data_hora(data, hora):
    d, pr = sentinela.aplicar("data", data)
    if d is None:
        return None, pr
    if isinstance(d, datetime.datetime):
        d = d.date()
    if hora is None or (isinstance(hora, (str, bytes, bytearray)) and not sentinela.aplicar("texto", hora)[0]):
        return datetime.datetime.combine(d, datetime.time()), None
    if isinstance(hora, datetime.datetime):
        h, pr = hora.time(), None
    elif isinstance(hora, datetime.time):
        h, pr = hora, None
    else:
        h, pr = sentinela.aplicar("hora_hhmm", hora)
    return (None, pr) if h is None else (datetime.datetime.combine(d, h), None)


class _Marca(str):
    """Marca de item desdobrado no modelo da linha (`#item`, `#item2`.., `#rotulo`, `#rotulo2`..)."""


def codigo_derivado(texto, n, prefixo=""):
    """(código, mudou): `prefixo` + texto se couber em n (o prefixo de domínio separa códigos de tabelas da origem que
    vão para o mesmo cadastro, sem pendência); senão prefixo + início + '~' + 8 hex do SHA-256 do texto (estável),
    com mudou=True (pendência baixa codigo_derivado)."""
    if texto is None:
        return None, False
    if len(prefixo) + len(texto) <= n:
        return prefixo + texto, False
    h = hashlib.sha256(texto.encode("utf-8")).hexdigest()[:8]
    return (prefixo + texto)[:max(0, n - 9)].rstrip() + "~" + h, True


def planejar(mapa_exec, presentes, excluir=frozenset(carga.ORDEM)):
    """Plano de carga em ordem do mapa: uma entrada por tabela carregável PRESENTE na origem com coluna declarada.
    Sem banco e sem Firebird (teste de unidade)."""
    geradas = {}
    for c in mapa_exec.get("colunas", []):
        geradas.setdefault(c["tabela"], {})[c["coluna"]] = c
    valores = {}
    for v in mapa_exec.get("valores", []):
        valores.setdefault((v["tabela"], v["coluna"], v["destino"]), {})[v["valor_origem"]] = v["valor_destino"]
    decl = {}
    for c in mapa_exec.get("colunas_decl", []):
        if (c.get("destino") or "").count(".") == 1:
            decl.setdefault(c["tabela"], []).append(c)
    quebras = {(d["tabela"], d["depende_de"]) for d in mapa_exec.get("deps", []) if d.get("quebra")}
    derivados = {c["tabela"] for c in mapa_exec.get("colunas_decl", []) if c["coluna"].startswith("#codigo_derivado:")}
    plano = []
    for r in sorted(mapa_exec["tabelas"], key=lambda r: int(r["ordem"]) if (r.get("ordem") or "").isdigit() else 10**9):
        t = r["tabela"]
        if not r.get("tabelas_destino") or t in excluir or t not in presentes or t not in decl:
            continue
        dts = mapa.principal_e_destinos(r["tabelas_destino"], decl[t])
        opcoes = mapa.opcoes_destino(decl[t])
        cols = {dt: [] for dt in dts}
        for c in decl[t]:
            dt, dc = c["destino"].split(".")
            g = geradas.get(t, {}).get(c["coluna"], {})
            rd = mapa.referencia_declarada(c)
            passos = mapa.passos_ref(rd) if rd and not mapa.ref_simples(rd) else None
            dp = c.get("depara") or g.get("depara") or ""
            termina_em_coluna = bool(passos) and "coluna" in passos[-1]
            # terminada em coluna, o valor vem do pai: a regra gerada da coluna desta tabela não vale para ele
            regra = c.get("regra") or ("texto" if termina_em_coluna else "chave_origem" if rd else g.get("regra") or "")
            col = {"coluna": c["coluna"], "destino": dc, "regra": regra or ("texto" if passos else ""),
                   "depara": dp, "referencia": rd or g.get("referencia") or "",
                   "valores": valores.get((t, c["coluna"], c["destino"]), {}) if dp == "valores" else None}
            if passos:  # só a referência composta, alternativa ou encadeada leva os passos
                col["passos"] = passos
            if c["coluna"].startswith("#dias:"):  # a regra declarada vale para o VALOR (nunca a gerada/da referência)
                col["regra"] = c.get("regra") or ""
            if c["coluna"].startswith("#data_hora_mais:"):  # a regra declarada vale para os MINUTOS
                col["regra"] = c.get("regra") or ""
            if c["coluna"].startswith(("#dif:", "#soma:")):  # a regra declarada vale para o RESULTADO
                col["regra"] = c.get("regra") or ""
            via = (c.get("via") or "").split(";")
            for o in mapa.OPCOES_COLUNA + ("por_pai",):
                if o in via:
                    col[o] = True
            cod = [x[4:] for x in via if x.startswith("cod:")]
            if cod:
                col["cod"] = mapa.cod_spec(cod[0])
            se = [mapa.condicao(x[3:]) for x in via if x.startswith("se:")]
            if se and se[0]:
                col["se"] = se[0]
            esp = [mapa.espelho_spec(x) for x in via if x.startswith("espelho:")]
            if esp and esp[0]:
                col["espelho"] = esp[0]
            if c["coluna"] == "@vigencia_carga" or c["coluna"].startswith("#vigencia") or (
                    c["coluna"] in ("=@data_carga", "=~@data_carga") and _DESTINO_VIGENCIA.search(dc)):
                col["vigencia"] = c["coluna"][10:].split(",") if c["coluna"].startswith("#vigencia:") else None
            tabs = [x["tabela"] for x in passos or [] if "tabela" in x]
            pai = (tabs[-1] if tabs and not termina_em_coluna else "") if passos else \
                (rd or g.get("referencia") or "") if not _especial(c["coluna"]) else ""
            if pai in derivados:
                col["pai_derivado"] = pai  # conciliação filho -> pai (ADR 0007, item 19)
            cols[dt].append(col)
        filtros = [f for c in decl[t] for x in (c.get("via") or "").split(";") if x.startswith("so_se:")
                   for f in [mapa.condicao(x[6:])] if f]
        chave = [x for x in (r.get("chave") or "").split(",") if x]
        lidas = list(chave)

        def ler(nome):
            if nome and nome not in lidas:
                lidas.append(nome)
        for dt in dts:
            for c in cols[dt]:
                n = c["coluna"]
                if n.startswith("#data:") or n.startswith("#data_hora:") or n.startswith("#dias:"):
                    for x in n.split(":", 1)[1].split(","):
                        ler(None if x.startswith("=") else x)
                for x in (fontes_especial(n) if _especial(n) else [n]):
                    ler(x)
                if c.get("passos"):
                    for x in mapa.colunas_da_linha(c["passos"][0]):
                        ler(x)
                if c.get("se"):
                    _ler_cond(c["se"], ler)
                if c.get("espelho") and c["espelho"]["edicao_coluna"]:
                    ler(c["espelho"]["edicao_coluna"])
            if (opcoes.get(dt) or {}).get("se") and "coluna" in opcoes[dt]["se"]:
                _ler_cond(opcoes[dt]["se"], ler)
            for spec, _ in opcoes.get(dt, {}).get("desdobrar", []):
                for col in spec.split("+"):
                    ler(col)
            for col in opcoes.get(dt, {}).get("agrupar", []):
                ler(col)
        for f in filtros:
            _ler_cond(f, ler)
        retratos = {}
        for dt in dts:
            for c in cols[dt]:
                sr = mapa.spec_retrato(c["coluna"])
                if sr is not None:
                    retratos[c["coluna"][8:] if c["coluna"].startswith("#sha256:") else c["coluna"]] = sr
                    for x in sr["extras"]:
                        ler(x)
        regras = {n: (geradas.get(t, {}).get(n, {}).get("regra") or "texto") for n in lidas}
        for c in decl[t]:
            if c.get("regra") and not _especial(c["coluna"]) and c["coluna"] in regras \
                    and not mapa.referencia_declarada(c):
                regras[c["coluna"]] = c["regra"]
        segredos = {fonte_especial(c["coluna"]) for c in decl[t] if c["coluna"].startswith(("#cofre:", "#senha"))}
        plano.append({"tabela": t, "chave": chave, "destinos": dts, "colunas": cols, "lidas": lidas,
                      "retrato": {n: r for n, r in regras.items() if n not in segredos},
                      "retratos": retratos, "segredos": segredos,
                      "regras_geradas": {n: g.get("regra") or "" for n, g in geradas.get(t, {}).items()},
                      "estrategia": r.get("estrategia", ""), "opcoes": {dt: opcoes.get(dt, {}) for dt in dts},
                      "filtros": filtros,
                      "duas_fases": {p for f, p in quebras if f == t} | {t}})
    return plano


def _valor_legivel(x):
    """Valor da origem como o cliente o lê no histórico da mescla (texto; data ISO; número canônico)."""
    if isinstance(x, (bytes, bytearray)):
        return "sha256:" + hashlib.sha256(x).hexdigest()
    if isinstance(x, (datetime.date, datetime.time)):
        return x.isoformat()
    if isinstance(x, (int, decimal.Decimal, float, bool)):
        return canon(x)
    return str(x)


def _ao_menos(a, b):
    """Estado do mecanismo: o do destino vale pelo menos o da origem (numérico) ou é igual."""
    try:
        return decimal.Decimal(str(a)) >= decimal.Decimal(str(b))
    except (decimal.InvalidOperation, ValueError, TypeError):
        return canon(a) == canon(b)


def _passos_em_duas_fases(c, p):
    """Referência por passos (chave alternativa, composta ou encadeada) terminada na tabela de uma aresta declarada em
    duas fases (`declarado/ciclos.tsv`) e sem `@coluna`: a chave do pai sai da origem agora e o id é gravado no fim
    (fase 2), como a referência simples (rodada 4: unidade -> profissional pelo CPF, ciclo com o profissional)."""
    ps = c.get("passos")
    return bool(ps) and not _especial(c["coluna"]) and "tabela" in ps[-1] and not ps[-1].get("coluna_destino") \
        and ps[-1]["tabela"] in p["duas_fases"] and ps[-1]["tabela"] != p["tabela"] and not c.get("cod")


def _ler_cond(cond, ler):
    ler(cond["coluna"])
    if cond.get("passos"):
        for x in mapa.colunas_da_linha(cond["passos"][0]):
            ler(x)


def canon(v, precisao=None):
    """Forma canônica de um campo na soma (mesma dos dois lados): texto em bytes CP1252, decimal normalizado, hora
    como TIME, data e hora truncadas à precisão do destino."""
    if isinstance(v, datetime.timedelta):  # TIME relido do MariaDB
        s = int(v.total_seconds())
        v = datetime.time(s // 3600 % 24, s // 60 % 60, s % 60, v.microseconds)
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, decimal.Decimal)) and not isinstance(v, bool):
        d = decimal.Decimal(v).normalize()
        return format(d, "f") if d else "0"
    if isinstance(v, datetime.time):
        return v.isoformat()
    return carga.fmt(v)


class _AvisoNoLote(Exception):
    """INSERT de várias linhas que gerou aviso (conversão silenciosa): o lote é desfeito e refeito em pedaços."""


class _PADRAO(str):
    """Marca, no resumo, a coluna que ficou com o padrão do destino (trocada pelo valor relido depois do INSERT)."""


def _truncar(v, precisao):
    """Data e hora na precisão de fração do destino (o que volta do banco é igual ao que foi gravado)."""
    if precisao is None or not isinstance(v, (datetime.datetime, datetime.time)):
        return v
    q = 10 ** (6 - min(6, int(precisao)))
    return v.replace(microsecond=(v.microsecond // q) * q)


class CargaMapa(carga.Carga):
    def __init__(self, leitor, cr, ctl, eid, imagem_id, mapa_exec, progresso=None, entidades_usadas=(),
                 sincronizar=False, limite_exclusao=None, confirmar_exclusao_em_massa=False, limite_global=None):
        super().__init__(leitor, cr, ctl, eid, imagem_id, progresso)
        # L9: Sincronizar (a origem vence; edição do destino guardada; exclusão lógica com reativação)
        self.sinc = bool(sincronizar)
        self.limite_exclusao = limite_exclusao or sincronizar_mod.LIMITE_EXCLUSAO
        self.confirmar_massa = bool(confirmar_exclusao_em_massa)
        self.limite_global = sincronizar_mod.LIMITE_GLOBAL if limite_global is None else limite_global
        self._excluidas = {}                # tabela -> chaves com exclusão lógica (conector_origem.excluido_em)
        self._estado = {}                   # (dt, chave em conector_origem) -> sha256 do destino antes da execução
        self._atualizar = None              # linha da origem sendo reaplicada (Sincronizar)
        self.sinc_res = {"atualizadas": 0, "conflitos": 0, "conflitos_itens": [], "excluidas": 0, "reativadas": 0,
                         "alertas_exclusao_em_massa": [], "blocos": {}, "sequencias": {}}
        self.mapa_exec = mapa_exec
        self.prop = Propagador()
        self.deparas = {}
        self.adiadas = []                   # (dt, coluna, id_linha, tabela_pai, chave_pai, tabela, chave)
        self.info = {}                      # dt -> {coluna: (nulo, tipo, precisao)}
        self.ent = {}                       # (tabela, dt) -> nome da entidade na conciliação
        self.usadas = set(entidades_usadas)
        self.plano = []
        self.cont.update(fase2_gravadas=0, fase2_pendentes=0)
        self._bloco = None
        self.seq = {}                       # posição da linha no grupo de `#seq:<COLUNA>` (linha atual)
        self._estab = False
        self.por_tabela = {}
        self.data_carga = datetime.datetime.now(datetime.timezone.utc).date()
        self.chaves = {r["tabela"]: [x for x in (r.get("chave") or "").split(",") if x]
                       for r in mapa_exec.get("tabelas", [])}
        self._origem_pai = {}               # (tabela, coluna) -> {chave do pai: valor} (referência encadeada)
        self._alt = {}                      # (tabela, coluna) -> {valor canônico: chave do pai ou AMBIGUO}
        self._cod = {}                      # (tabela, coluna, valor) -> id do destino, None ou AMBIGUO (`cod:`)
        self._unico = {}                    # tabela -> id da única linha ativa ou None (`@unico:`)
        self._princ = {}                    # tabela da origem -> destino principal (`ref:T@coluna`)
        self._col_dest = {}                 # (destino, coluna) -> {id: valor} (`ref:T@coluna`, cache limitado)
        self._cab = {}                      # (tabela, grupo) -> id do cabeçalho agrupado gravado nesta execução
        self._grupos = None                 # (destino agrupado, {chave: (grupo, pos.)}, {grupo: (agregados, membros)})
        self._grp = None                    # (grupo, posição) da linha atual
        self.tipos = {}                     # coluna da origem -> código do tipo (tabela atual)
        self._alt_lista = {}                # (tabela, coluna) -> {valor: [chaves do pai]} (valor repetido)
        self._leit = {}                     # grupos de leitura sem cabeçalho (`#grupo_seq@`, `#grupo_razao:`)
        self._filhos = {}                   # (tabela filha, coluna, FK) -> {FK: [valores]} (`#filhos_*`)
        # rodada 5 (ADR 0006 e 0007)
        self._linha = None                  # (tabela, chave) da linha em gravação (mescla, cofre)
        self._vig = {}                      # (tabela, colunas) -> ({chave: data mais antiga}, data mais antiga)
        self._vig_origem = False            # data do registro mais antigo da origem (evidência declarada)
        self._esp = {}                      # (catálogo, código, edição) -> id no espelho do cliente, None ou AMBIGUO
        self._criadas = set()               # tabelas de continuidade já garantidas no banco do cliente
        self._fila = []                     # linhas novas com a gravação adiada (bloco), na ordem
        self._adiando = self._esvaziando = False
        self._adiar_linha = False           # a linha atual pode ser adiada (decidido em _tabela)
        self._prox_id = {}                  # destino -> próximo id reservado no bloco
        # tabela grande dividida por faixa de chave entre gravadores (paralelo.py): as faixas deste gravador, os
        # limites [lo, hi) da chave (None = aberto), os destinos e a reserva de id por bloco do coordenador
        self._faixas_so, self._faixa_lim, self._faixa_dts, self._reservar = None, None, frozenset(), None
        self._autoinc = {}                  # destino -> tem `id` autoincremento
        self._filho_pai = {}                # (dt, coluna, tabela do pai) -> [(id da filha, id esperado do pai)]
        self.chave_cofre = continuidade.chave_mestra()

    # ----- destino -----
    def _info(self, dt):
        if dt not in self.info:
            rs = self._todas("SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, DATETIME_PRECISION, COLUMN_DEFAULT,"
                             " NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND"
                             " TABLE_NAME=%s", (dt,))
            if not rs:
                raise ErroCarga("tabela de destino inexistente no banco do cliente: %s" % dt)
            self.info[dt] = {c: (n == "YES", t, p, n != "YES" and d is not None and d != "NULL", e)
                             for c, n, t, p, d, e in rs}
        return self.info[dt]

    def _estabelecimento(self):
        """Id do único estabelecimento do cliente (None: nenhum ou vários). Nunca fixo por cliente."""
        if self._estab is False:
            ids = [r[0] for r in self._todas("SELECT id FROM estabelecimento LIMIT 2")] if self._um(
                "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                " TABLE_NAME='estabelecimento'") else []
            self._estab = ids[0] if len(ids) == 1 else None
        return self._estab

    def _id_por_codigo(self, tab, col, v):
        """Id da linha de `tab` do destino com `col` = v (`cod:`): None se ausente, _AMBIGUO se várias."""
        k = (tab, col, v)
        if k not in self._cod:
            ids = self._todas("SELECT id FROM `%s` WHERE `%s`=%%s LIMIT 2" % (tab, col), (v,))
            self._cod[k] = ids[0][0] if len(ids) == 1 else (_AMBIGUO if ids else None)
        return self._cod[k]

    def _id_por_codigos(self, tab, cols, vals):
        """`cod:<tabela>.(c1,c2)=(v1,v2)`: id da linha com todas as colunas; None se ausente, _AMBIGUO se várias."""
        k = (tab, tuple(cols), tuple(vals))
        if k not in self._cod:
            ids = self._todas("SELECT id FROM `%s` WHERE %s LIMIT 2" % (tab, " AND ".join("`%s`=%%s" % c for c in cols)),
                              tuple(vals))
            self._cod[k] = ids[0][0] if len(ids) == 1 else (_AMBIGUO if ids else None)
        return self._cod[k]

    def _resolver_cod(self, cod, x, pend):
        """Valor -> id pelo `cod:` (simples ou composto); ausente ou repetido: NULL com a pendência."""
        if x is None:
            return None
        x = x if not isinstance(x, bool) else int(x)
        if len(cod) == 3:
            vs = [v[1:] if v.startswith("=") else x for v in cod[2]]
            r = self._id_por_codigos(cod[0], cod[1], vs)
        else:
            r = self._id_por_codigo(cod[0], cod[1], x)
        if r is None or r is _AMBIGUO:
            pend.append(("pai_ambiguo" if r is _AMBIGUO else "codigo_inexistente_destino", "media"))
            return None
        return r

    def _cond(self, linha, cond, pend=None):
        """Condição de linha (`mapa.condicao`): a coluna (ou a do pai pela encadeada) tem um dos valores.
        Pai inexistente ou ambíguo pela encadeada NUNCA é "valor vazio" (F4 conferidor: o nulo casava com o vazio de
        `REF_BRA=N,F,` e a linha de tabela licenciada fora do recorte passava como própria): a condição fica FORA e a
        regra do pai vai para `pend` (visível; ADR 0007, 19)."""
        v = linha.get(cond["coluna"])
        if cond.get("passos"):
            v, _, pr = self._seguir(linha, cond["coluna"], cond["passos"])
            if pr:
                if pend is not None:
                    pend.append((pr, "media"))
                return False
        if isinstance(v, (str, bytes, bytearray)):
            v = sentinela.aplicar("texto", v)[0]
        s = None if v is None else self._chave(v).strip()
        if cond.get("cod"):  # `@cod:`: o valor acha uma linha do destino (sem pendência: a coluna do `cod:` a deixa)
            if not s or s == "0" or (cond["valores"] is not None and s not in cond["valores"]):
                return False
            r = self._id_por_codigo(cond["cod"][0], cond["cod"][1], s)
            return r is not None and r is not _AMBIGUO
        if cond["valores"] is None:
            return bool(s)
        return (s or "") in cond["valores"]

    def _unica(self, tab):
        """Id da única linha ativa de `tab` (`@unico:`); None se nenhuma ou várias. Nunca fixo por cliente."""
        if tab not in self._unico:
            info = self._info(tab)
            filtro = " AND ".join((["`ativo`"] if "ativo" in info else []) +
                                  (["`excluido_em` IS NULL"] if "excluido_em" in info else [])) or "1"
            ids = self._todas("SELECT id FROM `%s` WHERE %s LIMIT 2" % (tab, filtro))
            self._unico[tab] = ids[0][0] if len(ids) == 1 else None
        return self._unico[tab]

    def _unicos_sem_caixa(self, dt):
        """Colunas de `dt` com índice único de uma coluna só e colação que não distingue caixa."""
        # duas consultas filtradas pela tabela (a junção das duas visões do information_schema levava ~2,5 s cada)
        idx = {}
        for nome, col in self._todas("SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS WHERE"
                                     " TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND NON_UNIQUE=0", (dt,)):
            idx.setdefault(nome, []).append(col)
        colac = dict(self._todas("SELECT COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE"
                                 " TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s", (dt,)))
        rs = [(nome, min(cols), len(cols), colac.get(min(cols))) for nome, cols in idx.items()]
        return {col for _, col, n, coll in rs if n == 1 and coll and not coll.endswith("_bin")
                and "_cs" not in coll}

    def _colisoes(self, p):
        """Chaves das linhas cujo código `codigo_char` colide pela caixa num destino de chave única sem caixa."""
        alvo = [c["coluna"] for dt in p["destinos"] for c in p["colunas"][dt]
                if c["regra"] == "codigo_char" and not _especial(c["coluna"]) and c["destino"] in self._unicos_sem_caixa(dt)]
        if not alvo:
            return set()
        por_col = {c: {} for c in alvo}
        for linha, ch_sem in self._linhas_mapa(p):
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            for c in alvo:
                x = sentinela.aplicar("codigo_char", linha[c])[0]
                if x is not None:
                    por_col[c].setdefault(x, []).append(chave)
        saida = set()
        for c, cods in por_col.items():
            for grupo in sentinela.colisoes_caixa(cods):
                for cod in grupo:
                    saida.update(cods[cod])
        return saida

    def _depara(self, cat):
        if cat not in self.deparas:
            existe = self._um("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                              " TABLE_NAME=%s", (depara.catalogo(cat)["tabela"],))
            pares = self._todas(depara.consulta(cat)) if existe else []
            if not pares:
                self._pendencia("-", None, "catalogo_oficial_ausente_%s" % cat, "alta")
            self.deparas[cat] = depara.Depara(cat, pares)
        return self.deparas[cat]

    # ----- leitura -----
    def _linhas_mapa(self, p):
        t = p["tabela"]
        cols = {c["nome"]: c for c in self.lt.colunas(t)}
        faltam = [c for c in p["lidas"] if c not in cols]
        if faltam:
            raise ErroCarga("tabela %s sem as colunas do mapa: %s" % (t, ", ".join(faltam)))
        self.subtipo = {n: c.get("subtipo") or 0 for n, c in cols.items()}
        self.tipos = {n: c.get("codigo_tipo") for n, c in cols.items()}
        ch = p["chave"]
        if len(ch) == 1 and self.lt.chave_primaria(t) == ch and cols[ch[0]]["codigo_tipo"] in TIPOS_INT:
            for ini, fim in (self._faixas_so if self._faixas_so is not None else self.lt.faixas(t, ch[0])):
                nomes, it = self.lt.ler_faixa(t, ch[0], ini, fim, colunas=p["lidas"])
                self._bloco = ini
                for x in it:
                    yield dict(zip(nomes, x)), None
            self._bloco = None
            return
        self._bloco = None
        nomes, it = self.lt.ler_tudo(t, colunas=p["lidas"])
        if ch:  # ordem fixa pela chave: decisões de duplicidade estáveis
            ix = [nomes.index(c) for c in ch]
            for x in sorted(it, key=lambda x: tuple(self._chave(x[i]) for i in ix)):
                yield dict(zip(nomes, x)), None
            return
        # sem chave: a chave é o hash da linha mais a ocorrência (multiconjunto de hashes)
        vistos = {}
        for h, x in sorted(((hash_linha(list(x)), x) for x in it), key=lambda y: y[0]):
            vistos[h] = vistos.get(h, 0) + 1
            yield dict(zip(nomes, x)), "h:%s#%d" % (h, vistos[h])

    def _faixas_divisao(self, p):
        """Faixas de chave da tabela inteira (ordem da chave), para dividir entre gravadores (paralelo.py)."""
        return list(self.lt.faixas(p["tabela"], p["chave"][0]))

    @staticmethod
    def _chave(v):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, decimal.Decimal) and v == v.to_integral_value():
            v = int(v)
        return chave_txt(v) if v is not None else ""

    # ----- valores -----
    def _referencia(self, t, chave, coluna, ref, raw):
        """(id, regra, gravidade): id do pai já carregado; pai recusado/pendente: ('pai_pendente', gravidade)."""
        if raw is None or (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
            return None, None, None
        return self._referencia_chave(t, chave, coluna, ref, self._chave(raw))

    # ----- referência composta, alternativa e encadeada (mapa.passos_ref) -----
    def _ler_pai(self, tab, colunas):
        """Linhas da origem de `tab` só com a chave e `colunas`: [(chave do pai, {coluna: valor})]."""
        ch = self.chaves.get(tab) or []
        if not ch:
            raise ErroCarga("referência declarada a tabela sem chave no mapa: %s" % tab)
        if tab not in set(self.lt.tabelas()):
            return []
        nomes, it = self.lt.ler_tudo(tab, colunas=list(dict.fromkeys(ch + list(colunas))))
        saida = []
        for x in it:
            d = dict(zip(nomes, x))
            saida.append(("|".join(self._chave(d[c]) for c in ch), d))
        return saida

    def _coluna_pai(self, tab, col):
        k = (tab, col)
        if k not in self._origem_pai:
            self._origem_pai[k] = {cp: d[col] for cp, d in self._ler_pai(tab, [col])}
        return self._origem_pai[k]

    def _chave_alternativa(self, tab, col):
        """{valor canônico da coluna (ou das colunas, tupla, unidas por '|'): chave do pai ou _AMBIGUO}."""
        k = (tab, col)
        cols = list(col) if isinstance(col, tuple) else [col]
        if k not in self._alt:
            m, lista = {}, {}
            for cp, d in self._ler_pai(tab, cols):
                if all(d[c] is None for c in cols):
                    continue
                v = "|".join(self._chave(d[c]).strip() for c in cols)
                m[v] = cp if v not in m else _AMBIGUO
                lista.setdefault(v, []).append(cp)
            self._alt[k] = m
            self._alt_lista[k] = {v: cps for v, cps in lista.items() if len(cps) > 1}
        return self._alt[k]

    def _desambiguar(self, s, k, v, ultimo, pend):
        """Vários pais na chave alternativa (rodada 4): `max:`/`min:` escolhe pelo valor da coluna (empate: menor
        chave; pendência baixa); no ÚLTIMO passo, todos apontando para a MESMA linha do destino (parcelas de um título
        agrupado) valem por ela. Senão _AMBIGUO."""
        cands = (getattr(self, "_alt_lista", None) or {}).get(k, {}).get(v)
        if not cands:
            return _AMBIGUO
        if s.get("escolha"):
            tipo, col = s["escolha"]
            vals = self._coluna_pai(s["tabela"], col)
            validos = [(vals.get(cp), cp) for cp in cands if vals.get(cp) is not None]
            if validos:
                alvo = (max if tipo == "max" else min)(x for x, _ in validos)
                cp = min((cp for x, cp in validos if x == alvo), key=_ord_chave)
            else:
                cp = min(cands, key=_ord_chave)
            if pend is not None:
                pend.append(("escolha_pelo_maior" if tipo == "max" else "escolha_pelo_menor", "baixa"))
            return cp
        if not ultimo:
            return _AMBIGUO
        tab = s["tabela"]
        if tab not in self.existente:
            self._carregar_existente(tab)
        suf = "/" + s["destino"] if s.get("destino") else ""
        ids = {(self.existente[tab].get(cp + suf) or (None,))[0] for cp in cands}
        return min(cands, key=_ord_chave) if len(ids) == 1 and None not in ids else _AMBIGUO

    def _seguir(self, linha, nome, passos, pend=None):
        """Segue os passos de uma referência declarada. (valor, (tabela, chave do pai) ou None, regra ou None):
        terminada em tabela devolve a chave do pai a resolver; terminada em coluna, o valor da origem do pai."""
        v, atual = linha.get(nome), None
        ult_tab = max(i for i, x in enumerate(passos) if "tabela" in x) if any("tabela" in x for x in passos) else -1
        for i, s in enumerate(passos):
            if "colunas" in s:  # chave composta do próximo passo pelas colunas da linha do pai (rodada 4)
                partes = []
                for col in s["colunas"]:
                    m = self._coluna_pai(atual[0], col)
                    if atual[1] not in m:
                        return None, None, "pai_inexistente"
                    partes.append(m[atual[1]])
                if all(x is None for x in partes):
                    return None, None, None
                v, atual = "|".join(self._chave(x) for x in partes), None
                continue
            if "coluna" in s:
                if atual[1] not in self._coluna_pai(atual[0], s["coluna"]):
                    return None, None, "pai_inexistente"
                v, atual = self._coluna_pai(atual[0], s["coluna"])[atual[1]], None
                continue
            if i == 0 and s["modo"] in ("composta", "alt_composta"):
                partes = [c[1:] if c.startswith("=") else linha[c] for c in (s.get("cols") or s["arg"])]
                for j, sub in (s.get("cadeias") or {}).items():  # componente encadeado `COL>T>X` (rodada 5)
                    vj, _, rj = self._seguir(linha, s["arg"][j], sub, pend)
                    if rj:
                        return None, None, rj
                    partes[j] = vj
                if all(x is None for x in partes):
                    return None, None, None
                if s["modo"] == "composta":
                    cp = "|".join(self._chave(x) for x in partes)
                else:
                    va = "|".join(self._chave(x).strip() for x in partes)
                    cp = self._chave_alternativa(s["tabela"], tuple(s["arg"])).get(va)
                    if cp is _AMBIGUO:
                        cp = self._desambiguar(s, (s["tabela"], tuple(s["arg"])), va, i == ult_tab, pend)
                    if cp is None:
                        return None, None, "pai_inexistente"
                    if cp is _AMBIGUO:
                        return None, None, "pai_ambiguo"
            else:
                if v is None or (isinstance(v, (int, float, decimal.Decimal)) and v == 0) or \
                        (isinstance(v, (str, bytes)) and not self._chave(v).strip()):
                    return None, None, None
                if s["modo"] == "alt":
                    va = self._chave(v).strip()
                    cp = self._chave_alternativa(s["tabela"], s["arg"]).get(va)
                    if cp is _AMBIGUO:
                        cp = self._desambiguar(s, (s["tabela"], s["arg"]), va, i == ult_tab, pend)
                    if cp is None:
                        return None, None, "pai_inexistente"
                    if cp is _AMBIGUO:
                        return None, None, "pai_ambiguo"
                else:
                    cp = self._chave(v)
            atual = (s["tabela"], cp)
        if atual is not None and passos[-1].get("destino"):  # id do destino secundário que o pai gravou
            atual = (atual[0], "%s/%s" % (atual[1], passos[-1]["destino"]))
        return v, atual, None

    def _referencia_chave(self, t, chave, coluna, ref, cpai):
        if ref not in self.existente:
            self._carregar_existente(ref)
        ant = self.existente[ref].get(cpai)
        if ant is None:
            return None, "pai_inexistente", "media"
        if ant[0] is None and ant[3]:
            if not self.prop.pendente(ref, cpai):
                self.prop.registrar(ref, cpai, ant[3], ant[4] or "alta")
            ps = self.prop.avaliar(t, chave, [(coluna, ref, cpai)])
            return None, "pai_pendente", (ps[0]["gravidade"] if ps else "alta")
        return ant[0], None, None

    def _principal(self, tab):
        """Destino principal de uma tabela da origem (o de `planejar`; sem declaração, o primeiro do mapa)."""
        if tab not in self._princ:
            r = next((r for r in self.mapa_exec.get("tabelas", []) if r["tabela"] == tab), {})
            decl = [c for c in self.mapa_exec.get("colunas_decl", [])
                    if c["tabela"] == tab and (c.get("destino") or "").count(".") == 1]
            dts = mapa.principal_e_destinos(r.get("tabelas_destino") or "", decl) if decl else \
                [x for x in (r.get("tabelas_destino") or "").split(";") if x]
            if not dts:
                raise ErroCarga("ref:...@coluna a tabela sem destino no mapa: %s" % tab)
            self._princ[tab] = dts[0]
        return self._princ[tab]

    def _coluna_destino(self, dt, col, rid):
        """Valor de `col` na linha `rid` de `dt` no DESTINO (o que o cliente vê), com cache limitado."""
        m = self._col_dest.setdefault((dt, col), {})
        if rid not in m:
            if len(m) > 200000:
                m.clear()
            r = self._todas("SELECT `%s` FROM `%s` WHERE id=%%s" % (col, dt), (rid,))
            m[rid] = r[0][0] if r else None
        return m[rid]

    def _converter(self, t, chave, p, linha, c, raw, pend, pode_adiar=False):
        """Uma coluna da origem pela referência (simples, composta, alternativa ou encadeada), de-para oficial ou de
        valores e regra. (valor, recusa ou None, chave do pai adiada ou None)."""
        nome = c["coluna"]
        regra = sentinela.regra_efetiva(c["regra"] or "texto", self.subtipo.get(nome, 0))
        if c.get("passos"):
            raw, alvo, pr = self._seguir(linha, nome, c["passos"], pend)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                return None, None, None
            if alvo is not None and pode_adiar and _passos_em_duas_fases(c, p):
                return None, None, alvo  # rodada 4: pai por chave alternativa/encadeada em duas fases (UPDATE no fim)
            if alvo is not None:
                x, pr, g = self._referencia_chave(t, chave, nome, alvo[0], alvo[1])
                if pr == "pai_pendente":
                    return None, (pr, g), None
                if pr:
                    pend.append((pr, g))
                ult = c["passos"][-1]
                if x is not None and ult.get("coluna_destino"):  # cópia da coluna do destino que o pai gravou
                    x = self._coluna_destino(ult.get("destino") or self._principal(alvo[0]), ult["coluna_destino"], x)
                return x, None, None
            if regra == "chave_origem":
                regra = "texto"
        pr = None
        if c["depara"] and depara.conhecido(c["depara"]):
            x, pr = self._depara(c["depara"]).resolver(raw)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        elif regra == "chave_origem" and c["referencia"] and not c.get("passos"):
            if c["referencia"] in p["duas_fases"]:
                if raw is not None and not (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
                    return None, None, self._chave(raw)
                return None, None, ""  # sem pai: nada a adiar, mas a coluna segue fora do resumo
            x, pr, g = self._referencia(t, chave, nome, c["referencia"], raw)
            if pr == "pai_pendente":
                return None, (pr, g), None
            if pr:
                pend.append((pr, g))
        else:
            x, pr = sentinela.aplicar(regra, raw)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        if c.get("valores") is not None and not pr:
            k = "" if x is None else ("1" if x is True else "0" if x is False else str(x))
            if k in c["valores"]:
                x = c["valores"][k] or None
            elif x is not None:
                if c.get("exige_dominio"):  # o código tem sentido de estado: sem par, a linha é recusada
                    return None, ("valor_fora_do_dominio", "media"), None
                x = None
                pend.append(("valor_fora_do_dominio", "media"))
        return x, None, None

    def _aritmetica(self, linha, c, pend):
        """`#dif:A,B` (A - B) e `#soma:A,B,..`: nulo vale 0; todas nulas: NULL; texto não numérico: NULL com
        valor_fora_do_dominio. A regra declarada na linha vale para o resultado (ex.: `piso:0`)."""
        nome = c["coluna"]
        nums = []
        for col in nome.split(":", 1)[1].split(","):
            v = linha[col]
            if isinstance(v, (bytes, bytearray)):
                v = v.decode("cp1252", "replace")
            if v is None or (isinstance(v, str) and not v.strip()):
                nums.append(None)
                continue
            try:
                nums.append(v if isinstance(v, decimal.Decimal) else decimal.Decimal(str(v).strip().replace(",", ".")))
            except decimal.InvalidOperation:
                pend.append(("valor_fora_do_dominio", "media"))
                return None
        if all(n is None for n in nums):
            return None
        nums = [n if n is not None else decimal.Decimal(0) for n in nums]
        x = nums[0] - nums[1] if nome.startswith("#dif:") else sum(nums, decimal.Decimal(0))
        if c.get("regra"):
            x, pr = sentinela.aplicar(c["regra"], x)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        return x

    def _por_pai(self, t, chave, linha, c, pend):
        """`por_pai`: todos os pais da chave alternativa (repetida ou não) da linha. ([(chave do pai, [id])] na ordem
        da chave do pai, recusa ou None). Sem valor: nenhum item (sem_item_a_gravar); valor sem pai: pai_inexistente;
        um pai pendente recusa a linha (pai_pendente, como a referência comum)."""
        s = c["passos"][0]
        if s["modo"] == "alt":
            v = linha.get(c["coluna"])
            if v is None or (isinstance(v, (int, float, decimal.Decimal)) and v == 0) or \
                    (isinstance(v, (str, bytes)) and not self._chave(v).strip()):
                return [], None
            k, va = (s["tabela"], s["arg"]), self._chave(v).strip()
        else:
            partes = [x[1:] if x.startswith("=") else linha[x] for x in (s.get("cols") or s["arg"])]
            if all(x is None for x in partes):
                return [], None
            k, va = (s["tabela"], tuple(s["arg"])), "|".join(self._chave(x).strip() for x in partes)
        cp = self._chave_alternativa(*k).get(va)
        cands = self._alt_lista.get(k, {}).get(va, []) if cp is _AMBIGUO else ([cp] if cp is not None else [])
        if not cands:
            return None, ("pai_inexistente", "media")
        suf = "/" + s["destino"] if s.get("destino") else ""
        itens = []
        for cpai in sorted(cands, key=_ord_chave):
            x, pr, g = self._referencia_chave(t, chave, c["coluna"], s["tabela"], cpai + suf)
            if pr == "pai_pendente":
                return None, (pr, g)
            if pr:
                pend.append((pr, g))
            if x is not None:
                itens.append((cpai, [x]))
        return itens, (None if itens else ("pai_inexistente", "media"))

    def _arquivo(self, t, chave, dt, linha, nome, pend):
        """`#arquivo:<COLUNA>[:<finalidade>]` (conferidor r4, ADR 0004): o binário da coluna vai para o armazenamento
        de arquivos da instalação (`ARQUIVOS_RAIZ`, uma pasta por banco de cliente), gravado UMA vez (temporário +
        rename, somente leitura, endereçado pelo SHA-256: o mesmo conteúdo é o mesmo arquivo), e o registro em `arquivo`
        (hash, tamanho, tipo, origem migracao, imutável) dá o id. Sem valor: NULL. Sem armazenamento configurado: NULL
        com `armazenamento_indefinido` (alta). Nunca grava o binário no banco nem fora da raiz."""
        partes = nome.split(":")
        col, fin = partes[1], (partes[2] if len(partes) > 2 else "anexo")
        v = linha.get(col)
        if isinstance(v, str):
            v = v.encode("cp1252", errors="replace")
        if v is None or len(v) == 0:
            return None
        v = bytes(v)
        raiz = os.environ.get("ARQUIVOS_RAIZ") or ""
        if not raiz or not os.path.isdir(raiz):
            pend.append(("armazenamento_indefinido", "alta"))
            return None
        h = hashlib.sha256(v).hexdigest()
        mime, ext = _tipo_arquivo(v)
        rel = "migracao/%s/%s" % (h[:2], h)
        if not hasattr(self, "_banco_cliente"):
            self._banco_cliente = re.sub(r"[^A-Za-z0-9_]", "_", self._um("SELECT DATABASE()") or "cliente")
        destino = os.path.join(raiz, self._banco_cliente, rel)
        if os.path.exists(destino):
            if os.path.getsize(destino) != len(v):
                pend.append(("arquivo_divergente_no_armazenamento", "alta"))
                return None
        else:
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            tmp = "%s.%d.tmp" % (destino, os.getpid())
            with open(tmp, "xb") as fh:
                fh.write(v)
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o444)
            try:
                os.link(tmp, destino)  # criação exclusiva: nunca sobrescreve
            except FileExistsError:
                pass
            finally:
                os.unlink(tmp)
        r = self._um("SELECT id FROM arquivo WHERE chave_armazenamento=%s", (rel,))
        if r is None:
            with self._c() as c:
                c.execute("INSERT INTO arquivo (entidade, finalidade, nome_original, tipo_mime, tamanho_bytes, hash_sha256,"
                          " chave_armazenamento, imutavel, origem, criado_em) VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE,"
                          " 'migracao', UTC_TIMESTAMP(3))",
                          (dt, fin, ("%s-%s%s" % (t, chave, ext))[:255], mime, len(v), h, rel))
                r = c.lastrowid
        return r

    def _texto_fonte(self, c, linha):
        """Valor convertido da coluna de origem de uma especial (`#sha256`, `#codigo_derivado`), pela regra declarada
        na própria linha especial (padrão: texto)."""
        cols = fontes_especial(c["coluna"]) if c["coluna"].startswith("#codigo_derivado:") else \
            [fonte_especial(c["coluna"])]
        xs = [sentinela.aplicar(sentinela.regra_efetiva(c["regra"] or "texto", self.subtipo.get(col, 0)),
                                linha[col])[0] for col in cols]
        if len(xs) == 1:
            return xs[0]
        return None if all(x is None for x in xs) else "_".join("" if x is None else str(x) for x in xs)

    def _preparar(self, p):
        """Na carga, com o dicionário vivo: `#retrato:*` lê TODAS as colunas da tabela (também no hash da linha)."""
        if p.get("_preparado"):
            return
        p["_preparado"] = True
        if any(r["todas"] for r in (p.get("retratos") or {}).values()):
            for c in self.lt.colunas(p["tabela"]):
                if c["nome"] not in p["lidas"]:
                    p["lidas"].append(c["nome"])

    def _regras_retrato(self, p, spec):
        """{coluna: regra} do retrato `spec` (`#retrato`, `#retrato:*...`, `#retrato:A,B`), sem segredo."""
        sr = (p.get("retratos") or {}).get(spec)
        if not sr or not sr["todas"]:
            return p["retrato"]
        saida = {}
        for n in p["lidas"]:
            if n in p.get("segredos", ()) or n in sr["exceto"] or mapa.SEGREDO_NOME.search(n):
                continue
            r = p["retrato"].get(n) or (p.get("regras_geradas") or {}).get(n)
            if not r:
                r = "blob" if self.tipos.get(n) == 261 and not self.subtipo.get(n) else \
                    "texto_longo" if self.tipos.get(n) == 261 else "texto"
            saida[n] = r
        return saida

    def _retrato(self, p, linha, spec="#retrato"):
        """JSON estável das colunas do retrato, convertidas (sem segredo)."""
        d = {}
        for n, r in sorted(self._regras_retrato(p, spec).items()):
            r = "texto" if r == "chave_origem" else r
            x = sentinela.aplicar(sentinela.regra_efetiva(r, self.subtipo.get(n, 0)), linha[n])[0]
            if isinstance(x, (bytes, bytearray)):
                x = "sha256:" + hashlib.sha256(x).hexdigest()
            elif isinstance(x, (datetime.date, datetime.time)):
                x = x.isoformat()
            elif isinstance(x, (decimal.Decimal, float)):
                x = canon(decimal.Decimal(str(x)))
            d[n] = x
        return json.dumps(d, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def _em_dias(self, linha, c, pend):
        """`#dias:<VALOR>,<UNIDADE>`: quantidade (pela regra declarada na linha) e unidade (coluna, pai por `ref:T>COL`
        e de-para de valores; ou literal `=ano`) em dias inteiros (`sentinela.periodo_em_dias`)."""
        cv, cu = c["coluna"][6:].split(",", 1)
        v = linha[cv]
        if c.get("regra"):
            v, pr = sentinela.aplicar(sentinela.regra_efetiva(c["regra"], self.subtipo.get(cv, 0)), v)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                return None
        if v is None or (isinstance(v, (str, bytes, bytearray)) and not sentinela.aplicar("texto", v)[0]):
            return None
        if cu.startswith("="):
            u = cu[1:]
        else:
            u = linha[cu]
            if c.get("passos"):
                u, _, pr = self._seguir(linha, cu, c["passos"])
                if pr:
                    pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                    return None
            u = sentinela.aplicar("texto", u)[0] if isinstance(u, (str, bytes, bytearray)) else u
            if u is not None and c.get("valores") is not None:
                k = str(u)
                if not c["valores"].get(k):
                    pend.append(("valor_fora_do_dominio", "media"))
                    return None
                u = c["valores"][k]
        x, pr = sentinela.periodo_em_dias(v, u)
        if pr:
            pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        return x

    def _data_hora_mais(self, t, chave, linha, c, pend):
        """`#data_hora_mais:<DATA>,<HORA>,<MINUTOS>`: data + hora somadas da duração (regra declarada na linha; sem
        valor, a de outra tabela pela `ref:` da via). Sem duração: NULL com duracao_ausente."""
        cd, ch, cm = c["coluna"][16:].split(",")
        base, pr = data_hora_composta(linha[cd], linha[ch])
        if pr or base is None:
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
            return None
        regra = sentinela.regra_efetiva(c.get("regra") or "inteiro", self.subtipo.get(cm, 0))
        mins, pr = sentinela.aplicar(regra, linha[cm])
        if mins is None and not pr and c.get("passos"):
            raw, alvo, pr = self._seguir(linha, cm, c["passos"], pend)
            if not pr and alvo is not None:
                x, pr, g = self._referencia_chave(t, chave, c["coluna"], alvo[0], alvo[1])
                ult = c["passos"][-1]
                if pr:
                    pend.append((pr, g))
                    return None
                mins = self._coluna_destino(ult.get("destino") or self._principal(alvo[0]), ult["coluna_destino"],
                                            x) if ult.get("coluna_destino") else None
            elif not pr:
                mins, pr = sentinela.aplicar(regra, raw)
        if pr:
            pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
            return None
        if mins is None:
            pend.append(("duracao_ausente", "media"))
            return None
        try:
            mins = int(mins)
        except (TypeError, ValueError):
            mins = -1
        if mins < 0:
            pend.append(("valor_fora_do_dominio", "media"))
            return None
        fim = base + datetime.timedelta(minutes=mins)
        if fim.date() > base.date():
            pend.append(("virada_de_dia", "baixa"))
        return fim

    def _filhos_agregado(self, p, chave, c, pend):
        """`#filhos_min|max|somar|contar:T1.C1|T2.C2@FK`: agregado das linhas das tabelas FILHAS da origem cuja FK é
        a chave desta linha (só leitura da imagem; cache por execução)."""
        tipo, resto = c["coluna"][8:].split(":", 1)
        alvos, fk = resto.rsplit("@", 1)
        geradas = {}
        for g in self.mapa_exec.get("colunas", []):
            geradas[(g["tabela"], g["coluna"])] = g.get("regra") or ""
        xs = []
        for alvo in alvos.split("|"):
            tf, col = alvo.split(".")
            k = (tf, col, fk)
            if k not in self._filhos:
                m = {}
                if tf in set(self.lt.tabelas()):
                    regra = c.get("regra") or geradas.get((tf, col)) or "texto"
                    regra = "texto" if regra == "chave_origem" else regra
                    nomes, it = self.lt.ler_tudo(tf, colunas=[fk, col])
                    for x in it:
                        d = dict(zip(nomes, x))
                        if d[fk] is None:
                            continue
                        y = sentinela.aplicar(regra, d[col])[0]
                        m.setdefault(self._chave(d[fk]), []).append(y)
                self._filhos[k] = m
            xs += self._filhos[k].get(chave, [])
        if tipo == "contar":
            return len(xs)
        vs = [x for x in xs if x is not None]
        if tipo == "somar":
            return sum((decimal.Decimal(str(x)) for x in vs), decimal.Decimal(0))
        if not vs:
            pend.append(("sem_filho_com_valor", "media"))
            return None
        return min(vs) if tipo == "min" else max(vs)

    def _montar_leituras(self, p):
        """Grupos de leitura sem cabeçalho (`#grupo_seq@C1,C2`, `#grupo_razao:V@C1,C2`): posição da linha no grupo
        (ordem da chave) e soma de V do grupo, de todas as linhas lidas."""
        self._leit = {}
        specs = [c for dt in p["destinos"] for c in p["colunas"][dt]
                 if c["coluna"].startswith("#grupo_seq@") or c["coluna"].startswith("#grupo_razao:")]
        if not specs:
            return
        for linha, ch_sem in self._linhas_mapa(p):
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            for c in specs:
                n = c["coluna"]
                cols = [x for x in n.split("@", 1)[1].split(",") if x != "*"]  # `@*`: a tabela inteira (r6)
                partes = [sentinela.aplicar("texto", linha[x])[0] if isinstance(linha[x], (str, bytes, bytearray))
                          else linha[x] for x in cols]
                g = "|".join("" if x is None else self._chave(x) for x in partes)
                por, cont, soma_g = self._leit.setdefault(n, ({}, {}, {}))
                cont[g] = cont.get(g, 0) + 1
                v = None
                if n.startswith("#grupo_razao:"):
                    col = n[13:].split("@")[0]
                    r = c.get("regra") or (p.get("regras_geradas") or {}).get(col) or "decimal"
                    v = sentinela.aplicar(sentinela.regra_efetiva(r, self.subtipo.get(col, 0)), linha[col])[0]
                    if v is not None:
                        v = decimal.Decimal(str(v))
                        soma_g[g] = soma_g.get(g, decimal.Decimal(0)) + v
                por[chave] = (g, cont[g], v)

    def _leitura(self, nome, chave, escala, pend):
        por, _, soma_g = self._leit[nome]
        g, pos, v = por[chave]
        if nome.startswith("#grupo_seq@"):
            return pos
        tot = soma_g.get(g)
        if v is None:
            return None
        if not tot:
            pend.append(("valor_fora_do_dominio", "media"))
            return None
        x = v / tot * 100
        return x.quantize(decimal.Decimal(1).scaleb(-int(escala)), rounding=decimal.ROUND_HALF_UP) \
            if escala is not None else x

    def _valores(self, p, linha, chave):
        """{dt: [(sufixo, {coluna destino: valor})]}, {dt: [(colunas, resumo)]}, pendências [(regra, grav)], recusa
        (regra, grav) ou None, adiadas [(dt, coluna, ref, chave_pai)]. Sufixo '' é a linha única do destino; o
        destino desdobrado tem um sufixo (rótulo) por item; o opcional sem valor da origem fica com lista vazia."""
        t = p["tabela"]
        vals, campos, pend, adiadas = {}, {}, [], []
        self._presumidas = set()  # (destino, coluna) gravada por valor presumido (`=~x`) nesta linha
        for dt in p["destinos"]:
            info = self._info(dt)
            op = (p.get("opcoes") or {}).get(dt) or {}
            if op.get("se") and not self._cond(linha, op["se"], pend):  # destino_se: o secundário não grava
                vals[dt], campos[dt] = [], []
                continue
            modelo, algum = [], False          # [(coluna destino, valor ou marca)] na ordem declarada
            fora, apagar, pp_itens = {}, set(), None  # `senao`: pendências fora do domínio por coluna; `por_pai`
            pos = {}                           # coluna destino -> posição no modelo (colunas concorrentes)
            marcas = {}                        # marca de item -> declaração (`cod:` no #item/#rotulo)
            for c in p["colunas"][dt]:
                nome, dc = c["coluna"], c["destino"]
                if nome == "@id" or nome.startswith("@id:") or nome.startswith("#item@"):
                    continue  # preenchido na gravação (id do principal ou do secundário `antes`); fora do resumo
                if mapa.eh_item(nome):
                    pos[dc] = len(modelo)
                    modelo.append((dc, _Marca(nome)))
                    marcas[nome] = c
                    continue
                n0 = len(pend)
                if c.get("se") and not self._cond(linha, c["se"], pend):
                    x = None  # condição da coluna fora: NULL sem pendência (a próxima concorrente é tentada)
                elif nome.startswith("=~"):
                    x = nome[2:]
                    # presumida só quando é a gravada (`marca`: em toda linha, aviso deliberado da fatia)
                    gravada = not (dc in pos and modelo[pos[dc]][1] is not None)
                    if c.get("marca") or gravada:
                        pend.append(("valor_presumido", "baixa"))
                    if gravada:
                        self._presumidas.add((dt, dc))
                elif c.get("por_pai"):
                    pp_itens, recusa = self._por_pai(t, chave, linha, c, pend)
                    if recusa:
                        return None, None, pend, recusa, []
                    pos[dc] = len(modelo)
                    modelo.append((dc, _Marca("#item")))
                    continue
                elif nome.startswith("="):
                    x = nome[1:]
                elif c.get("vigencia", False) is not False and "vigencia" in c:
                    x = self._vigencia(p, linha, chave, c["vigencia"], pend)
                    algum = algum or x is not None
                elif nome == "@estabelecimento":
                    x = self._estabelecimento()
                    if x is None:
                        return None, None, pend, ("estabelecimento_indefinido", "alta"), []
                elif nome.startswith("@unico:"):
                    x = self._unica(nome[7:])
                    if x is None:
                        return None, None, pend, ("cadastro_unico_indefinido", "alta"), []
                elif nome.startswith("#seq:"):
                    x = self.seq[nome[5:]]
                elif mapa.spec_retrato(nome) is not None:  # `#retrato...` e `#sha256:#retrato...`
                    j = self._retrato(p, linha, nome[8:] if nome.startswith("#sha256:") else nome)
                    x = hashlib.sha256(j.encode("utf-8")).hexdigest() if nome.startswith("#sha256:") else j
                elif nome.startswith("#grupo_seq@") or nome.startswith("#grupo_razao:"):
                    x = self._leitura(nome, chave, (info.get(dc) or (None,) * 5)[4], pend)
                    algum = algum or x is not None
                elif nome.startswith("#grupo_"):
                    x = self._agregado(nome)
                    algum = algum or x is not None
                elif nome.startswith("#filhos_"):
                    x = self._filhos_agregado(p, chave, c, pend)
                    algum = algum or x is not None
                elif nome.startswith("#data_hora_mais:"):
                    x = self._data_hora_mais(t, chave, linha, c, pend)
                    algum = algum or x is not None
                elif nome.startswith("#sha256:"):
                    y = self._texto_fonte(c, linha)
                    x = None if y is None else hashlib.sha256(
                        y if isinstance(y, (bytes, bytearray)) else str(y).encode("utf-8")).hexdigest()
                    algum = algum or x is not None
                elif nome.startswith("#codigo_derivado:"):
                    y = self._texto_fonte(c, linha)
                    _, _, n, pre = (nome.split(":") + [""])[:4]
                    x, mudou = codigo_derivado(None if y is None else str(y), int(n), pre)
                    if mudou:
                        pend.append(("codigo_derivado", "baixa"))
                    algum = algum or x is not None
                elif nome.startswith("#data:"):
                    x, pr = data_composta(*[linha[y] for y in nome[6:].split(",")])
                    if pr:
                        pend.append((pr, "media"))
                    algum = algum or x is not None
                elif nome.startswith("#data_hora:"):
                    xs = [linha[y] for y in nome[11:].split(",")]
                    x, pr = data_hora_composta(*xs, com_ref=len(xs) == 3)
                    if pr:
                        pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                    algum = algum or x is not None
                elif nome.startswith("#dias:"):
                    x = self._em_dias(linha, c, pend)
                    algum = algum or x is not None
                elif nome.startswith("#dif:") or nome.startswith("#soma:"):
                    x = self._aritmetica(linha, c, pend)
                    algum = algum or x is not None
                elif nome.startswith("#arquivo:"):
                    x = self._arquivo(t, chave, dt, linha, nome, pend)
                    algum = algum or x is not None
                elif nome.startswith("#cofre:"):
                    # ADR 0007 (17): o segredo vai CIFRADO ao cofre do cliente; a coluna recebe a referência. Sem
                    # chave mestra ou sem a biblioteca de cifra: NULL e a pendência (falha fechada), nunca em claro
                    x = self._cofre(t, chave, dt, dc, linha[fonte_especial(nome)], pend)
                    algum = algum or x is not None
                elif nome.startswith("#senha:"):  # senha legível ou reversível na origem: argon2id já na carga
                    y = sentinela.aplicar("texto", linha[fonte_especial(nome)])[0]
                    x = None if y is None else continuidade.argon2id(str(y))
                    if y is not None and x is None:
                        pend.append(("senha_aguarda_argon2", "media"))
                    algum = algum or x is not None
                elif nome.startswith("#senha_hash:"):  # hash conhecido: importado, a API regrava no 1º login
                    x, pr = continuidade.hash_importado(linha[fonte_especial(nome)], nome.split(":")[2])
                    if pr:
                        pend.append((pr, "media"))
                    algum = algum or x is not None
                else:
                    x, recusa, adiada = self._converter(t, chave, p, linha, c, linha[nome], pend,
                                                        pode_adiar=(info.get(dc) or (True,))[0])
                    if recusa:
                        return None, None, pend, recusa, []
                    if adiada is not None:
                        if isinstance(adiada, tuple):  # (tabela do pai, chave do pai) pelos passos
                            adiadas.append((dt, dc, adiada[0], adiada[1]))
                        elif adiada:
                            adiadas.append((dt, dc, c["referencia"], adiada))
                        continue  # coluna em duas fases: NULL agora, fora do resumo
                    if (info.get(dc) or (True,))[0] and _passos_em_duas_fases(c, p):
                        continue  # mesma coluna em duas fases sem pai a adiar: fica fora do resumo também
                    algum = algum or x is not None
                    if dc == "id" and op.get("complementa") and x is None:
                        return None, None, pend, ("pai_inexistente", "media"), []
                if x == "@data_carga" and "vigencia" in c:  # vigência: nunca a data da carga (ADR 0007, 16)
                    x = self._vigencia(p, linha, chave, None, pend)
                elif x == "@data_carga":
                    x = self.data_carga
                    if c.get("regra") and nome in ("=@data_carga", "=~@data_carga"):  # ex.: competência da carga
                        x, pr = sentinela.aplicar(c["regra"], x)
                        if pr:
                            pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                if c.get("cod") and x is not None:  # id pelo código no cadastro do destino
                    x = self._resolver_cod(c["cod"], x, pend)
                if c.get("espelho") and x is not None:  # ligação ao espelho padrão da base (ADR 0006, 3)
                    x = self._ligar_espelho(c["espelho"], x, linha, pend)
                if c.get("autor") and x is None:  # rascunho: o autor pelo login/chave; sem autor, pendência própria
                    pend[n0:] = [y for y in pend[n0:] if y[0] not in (
                        "pai_inexistente", "codigo_inexistente_destino", "pai_ambiguo")]
                    pend.append(("rascunho_sem_autor", "alta"))
                fora.setdefault(dc, []).extend(i for i in range(n0, len(pend))
                                               if pend[i][0] == "valor_fora_do_dominio")
                if dc in pos:  # coluna concorrente: vale a primeira com valor, na ordem declarada
                    if modelo[pos[dc]][1] is None and x is not None:
                        modelo[pos[dc]] = (dc, x)
                        if c.get("presumida"):  # valor ESTIMADO por outro caminho: visível ao cliente (ADR 0007)
                            pend.append(("valor_presumido", "baixa"))
                            self._presumidas.add((dt, dc))
                        if c.get("senao"):  # o valor veio por outro caminho: a recusa de domínio anterior sai
                            apagar.update(i for i in fora[dc] if i < n0)
                    continue
                pos[dc] = len(modelo)
                modelo.append((dc, x))
            if apagar:
                pend[:] = [x for i, x in enumerate(pend) if i not in apagar]
            itens = [("", None)]
            if pp_itens is not None:
                itens = pp_itens
            elif op.get("desdobrar"):
                itens = []
                cis = {mapa.posicao_item(c["coluna"]): c for c in p["colunas"][dt]
                       if c["coluna"].startswith("#item") and not c["coluna"].startswith("#item@")}
                # conferidor r4: `#item@<COLUNA>` dá ao item daquela coluna a própria regra, de-para e referência
                cis_col = {c["coluna"][6:]: c for c in p["colunas"][dt] if c["coluna"].startswith("#item@")}
                for spec, rot in op["desdobrar"]:
                    xs = []
                    for j, col in enumerate(spec.split("+")):
                        # rodada 4: a referência do #item (encadeada ou composta) e o `cod:` valem para o item
                        ci = cis_col.get(col, cis[j]) if j == 0 else cis[j]
                        x, recusa, _ = self._converter(t, chave, p, linha, dict(ci, coluna=col,
                                                                                passos=ci.get("passos")),
                                                       linha[col], pend)
                        if recusa:
                            return None, None, pend, recusa, []
                        if ci.get("cod") and x is not None:
                            x = self._resolver_cod(ci["cod"], x, pend)
                        xs.append(x)
                    if any(x is not None and (x is not False or op.get("com_falso")) for x in xs):
                        itens.append((rot, xs))
            elif op.get("opcional") and not algum:
                itens = []
            vals[dt], campos[dt] = [], []
            for rot, item in itens:
                v, cs, nomes = {}, [], []
                for dc, x in modelo:
                    if isinstance(x, _Marca):
                        k = mapa.posicao_item(x)
                        if x.startswith("#item"):
                            x = item[k] if k < len(item) else None
                        else:
                            partes = rot.split("|")
                            cm = marcas.get(str(x)) or {}
                            x = (partes[k] if k < len(partes) else "") or None
                            if cm.get("cod") and x is not None:  # o rótulo acha o id no destino (rodada 4)
                                x = self._resolver_cod(cm["cod"], x, pend)
                    ic = info.get(dc) or (True, None, None, False, None)
                    x = tipar(x, ic[1])
                    if x is NAO_NUMERICO:
                        x = None
                        pend.append(("valor_fora_do_dominio", "media"))
                    nomes.append(dc)
                    if x is None and ic[3]:  # NOT NULL com padrão: o destino decide; o resumo usa o valor relido
                        cs.append(_PADRAO(dc))
                        continue
                    x = _truncar(x, ic[2])
                    v[dc] = x
                    cs.append(x)
                if "origem" in info and "origem" not in v and not op.get("complementa"):
                    v["origem"] = "migracao"
                vals[dt].append((rot, v))
                campos[dt].append((nomes, cs))
        return vals, campos, pend, None, adiadas

    def _montar_grupos(self, p):
        """Destino agrupado (`antes;agrupar:C1,C2`): lê a tabela uma vez e monta os grupos (linhas com os mesmos
        valores em C1, C2; todas vazias: a linha sozinha) e os agregados `#grupo_*` de cada um."""
        self._grupos = None
        dtg = next((dt for dt in p["destinos"] if ((p.get("opcoes") or {}).get(dt) or {}).get("agrupar")), None)
        if dtg is None:
            return
        cg = p["opcoes"][dtg]["agrupar"]
        especs = [c for dt in p["destinos"] for c in p["colunas"][dt] if c["coluna"].startswith("#grupo_")]
        por_linha, membros, vals = {}, {}, {}
        for linha, ch_sem in self._linhas_mapa(p):
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            partes = [sentinela.aplicar("texto", linha[x])[0] if isinstance(linha[x], (str, bytes, bytearray))
                      else linha[x] for x in cg]
            g = ("linha:" + chave) if all(x is None for x in partes) else \
                "|".join("" if x is None else self._chave(x) for x in partes)
            ms = membros.setdefault(g, [])
            por_linha[chave] = (g, len(ms) + 1)
            ms.append(chave)
            for c in especs:
                if c["coluna"].startswith("#grupo_json:"):  # rodada 4: lista das colunas de cada linha do grupo
                    d = {}
                    for col in c["coluna"][12:].split(","):
                        if col in p.get("segredos", ()) or mapa.SEGREDO_NOME.search(col):
                            continue
                        r = (p.get("regras_geradas") or {}).get(col) or "texto"
                        r = "texto" if r == "chave_origem" else r
                        d[col] = _valor_json(sentinela.aplicar(sentinela.regra_efetiva(r, self.subtipo.get(col, 0)),
                                                               linha[col])[0])
                    vals.setdefault((g, c["coluna"]), []).append(d)
                    continue
                col = fonte_especial(c["coluna"])
                if col:
                    r = c["regra"] or (p.get("regras_geradas") or {}).get(col) or "texto"
                    x = sentinela.aplicar(sentinela.regra_efetiva(r, self.subtipo.get(col, 0)), linha[col])[0]
                    if x is not None:
                        vals.setdefault((g, c["coluna"]), []).append(x)
        grupos = {}
        for g, ms in membros.items():
            ag = {"#grupo_contar": len(ms)}
            for c in especs:
                n, xs = c["coluna"], vals.get((g, c["coluna"]))
                if n.startswith("#grupo_somar:"):
                    ag[n] = sum(decimal.Decimal(str(x)) for x in xs) if xs else None
                elif n.startswith("#grupo_min:"):
                    ag[n] = min(xs) if xs else None
                elif n.startswith("#grupo_max:"):
                    ag[n] = max(xs) if xs else None
                elif n.startswith("#grupo_json:"):
                    ag[n] = json.dumps(xs or [], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            grupos[g] = (ag, ms)
        self._grupos = (dtg, por_linha, grupos)

    def _agregado(self, nome):
        g, i = self._grp
        return i if nome == "#grupo_seq" else self._grupos[2][g][0].get(nome)

    def _cabecalho(self, t, dt, chave, principal=False):
        """(id do cabeçalho do grupo da linha ou None, de execução anterior): o gravado nesta execução ou o de um
        membro do grupo já carregado antes. No destino PRINCIPAL agrupado (rodada 4), a chave do membro é a dele."""
        g = self._grp[0]
        if (t, g) in self._cab:
            return self._cab[(t, g)], False
        # Varredura dos membros só uma vez por (tabela, grupo): sem cabeçalho achado, as linhas seguintes do mesmo grupo
        # não varrem de novo (antes era O(n) por linha: 1 milhão de membros num grupo davam 40 linhas/s na carga real).
        # O cabeçalho gravado depois nesta execução entra em self._cab e é achado antes daqui.
        varridos = self.__dict__.setdefault("_cab_varrido", set())
        if (t, g) in varridos:
            return None, False
        ex = self.existente.get(t, {})
        for m in self._grupos[2][g][1]:
            # Sincronizar de uma linha já carregada: o cabeçalho dela mesma vale (único membro do grupo)
            proprio = getattr(self, "_atualizar", None) is not None
            e = ex.get(m if principal else "%s/%s" % (m, dt)) if m != chave or proprio else None
            if e and e[0] is not None:
                return e[0], True
        varridos.add((t, g))
        return None, False

    def _linha_nova(self, tab, chave, entidade, h, fazer):
        """Como na carga própria, e também desfaz os contadores do Sincronizar da linha recusada por restrição (o
        resumo só conta atualização e conflito que ficaram no banco)."""
        if self._adiar_linha:
            return self._linha_adiada(tab, chave, entidade, h, fazer)
        if self._fila:  # a linha linha a linha guarda índices de memória: o bloco é gravado antes
            self._esvaziar()
        r = self.sinc_res
        marca = ({k: x for k, x in r.items() if isinstance(x, int)}, len(r["conflitos_itens"]))
        ids = super()._linha_nova(tab, chave, entidade, h, fazer)
        if ids is None:
            r.update(marca[0])
            del r["conflitos_itens"][marca[1]:]
        return ids

    # ----- gravação em bloco (velocidade-carga, 2026-11-22) -----
    # A linha NOVA simples (sem cabeçalho agrupado, adoção, complemento, provisório, Sincronizar ou padrão do
    # destino) tem as inserções adiadas: id reservado em memória (MAX(id)+1 do destino), INSERT de várias linhas por
    # tabela e `conector_origem` em lote no fim do bloco (antes de qualquer outra conversa com o banco e de todo
    # commit), sob SAVEPOINT do bloco. Restrição do destino no bloco: ROLLBACK do bloco e o bloco refeito linha a
    # linha, cada uma sob o SAVEPOINT dela; só a linha que falhar é desfeita (banco, memória, pendências e
    # contadores) e recusada com `restricao_destino_<código>`, exatamente como na gravação linha a linha.
    LOTE_SQL_LINHAS = 500
    LOTE_SQL_BYTES = 4 << 20

    def _c(self):
        if self._fila and not self._esvaziando:
            self._esvaziar()
        return self.cr.cursor()

    def _commit(self):
        self._esvaziar()
        if self._buf:  # INSERT de várias linhas (o executemany não junta linhas com a função de data no VALUES)
            with self._c() as c:
                self._sql_lote(c, "INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra,"
                                  " gravidade, detalhe, criado_em) VALUES " % self.ctl,
                               "(%d, %%s, %%s, %%s, %%s, %%s, %s)" % (int(self.eid), AGORA), "", self._buf)
            self._buf = []
        super()._commit()

    def _adiavel(self, p):
        """A tabela pode ter linhas adiadas: destinos com `id` autoincremento, nenhum destino agrupado, adotado ou
        complementado, e nenhuma menção à própria tabela nas colunas (autorreferência fica linha a linha)."""
        t, ops = p["tabela"], p.get("opcoes") or {}
        if os.environ.get("CONECTOR_SEM_LOTE") == "1":  # chave de segurança: volta à gravação linha a linha
            return False
        for dt in p["destinos"]:
            op = ops.get(dt) or {}
            if op.get("agrupar") or op.get("adotar") or op.get("complementa"):
                return False
            if dt not in self._autoinc:
                with self.cr.cursor() as c:
                    c.execute("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()"
                              " AND TABLE_NAME=%s AND COLUMN_NAME='id' AND EXTRA LIKE '%%auto_increment%%'", (dt,))
                    self._autoinc[dt] = bool(c.fetchone()[0])
            if not self._autoinc[dt]:
                return False
        return not re.search(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(t),
                             json.dumps(p["colunas"], default=str))

    def _inserir(self, tabela, valores):
        if self._faixa_lim is not None and tabela in self._faixa_dts and valores.get("id") is None:
            # tabela dividida por faixa: o id vem do bloco reservado a este gravador pelo coordenador (sem colisão
            # com os outros gravadores do mesmo destino; o MAX+1 não vale com dois gravadores no destino)
            valores = dict(valores, id=self._reservar(tabela))
            if not self._adiando:
                if self._fila:
                    self._esvaziar()
                super()._inserir(tabela, valores)
                return valores["id"]
        if not self._adiando:
            if self._fila:
                self._esvaziar()
            self._prox_id.pop(tabela, None)  # o autoincremento andou fora da reserva
            return super()._inserir(tabela, valores)
        if valores.get("id") is not None:
            rid = valores["id"]
        else:
            if tabela not in self._prox_id:  # sem conversa pelo _c: a reserva não esvazia o bloco
                with self.cr.cursor() as c:
                    c.execute("SELECT COALESCE(MAX(id), 0) FROM `%s`" % tabela)
                    self._prox_id[tabela] = int(c.fetchone()[0]) + 1
            rid = self._prox_id[tabela]
            valores = dict(valores, id=rid)
        self._prox_id[tabela] = max(self._prox_id.get(tabela, 0), rid + 1)
        cols = tuple(c for c in valores if c != "criado_em")
        com_data = valores.get("criado_em") is not None
        args = [valores[k] for k in cols] + ([valores["criado_em"]] if com_data else [])
        self._fila[-1]["ins"].append((tabela, cols + ("criado_em",), com_data, args))
        return rid

    def _registrar(self, tab, chave, entidade, id_destino, h, hd=None, recusa=None):
        if not self._adiando:
            return super()._registrar(tab, chave, entidade, id_destino, h, hd, recusa)
        regra, grav = recusa or (None, None)
        self._fila[-1]["reg"].append((tab, chave, entidade, id_destino, h, hd, regra, grav, self.img))
        t = self.existente.setdefault(tab, {})
        self._diario.append((tab, chave, t.get(chave)))
        t[chave] = (id_destino, h, hd, regra, grav)

    def _linha_adiada(self, tab, chave, entidade, h, fazer):
        rec = {"linha": (tab, chave, entidade, h), "ins": [], "reg": [], "origem": [], "adiadas": None,
               "seq": len(self._fila),
               "ini": (len(self._diario), len(self.pend), len(self._buf)), "cont": dict(self.cont)}
        self._fila.append(rec)
        self._adiando = True
        try:
            ids = fazer()
        except BaseException:
            self._fila.pop()
            raise
        finally:
            self._adiando = False
        rec["fim"] = (len(self._diario), len(self.pend), len(self._buf))
        rec["dcont"] = {k: x - rec["cont"].get(k, 0) for k, x in self.cont.items()
                        if isinstance(x, int) and x != rec["cont"].get(k, 0)}
        del rec["cont"]
        return ids

    def _sql_lote(self, c, cab, tupla, fim, linhas):
        """INSERT de várias linhas em pedaços (até LOTE_SQL_LINHAS linhas e cerca de LOTE_SQL_BYTES)."""
        i = 0
        while i < len(linhas):
            j, tam = i, 0
            while j < len(linhas) and j - i < self.LOTE_SQL_LINHAS and (j == i or tam < self.LOTE_SQL_BYTES):
                tam += sum(len(x) for x in linhas[j] if isinstance(x, (bytes, str)))
                j += 1
            c.execute(cab + ",".join([tupla] * (j - i)) + fim, [x for a in linhas[i:j] for x in a])
            if j - i > 1 and getattr(c._result, "warning_count", 0):
                # no INSERT de várias linhas o MariaDB troca NULL em coluna NOT NULL pelo padrão implícito, com aviso
                # (linha a linha é o erro 1048): todo aviso desfaz o lote, que é refeito até a linha sozinha
                raise _AvisoNoLote()
            i = j

    def _sql_reg(self):
        cab = ("INSERT INTO %s.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
               " hash_linha, hash_destino, regra_recusa, gravidade_recusa, imagem_id, criado_em) VALUES " % self.ctl)
        fim = (" ON DUPLICATE KEY UPDATE id_destino=VALUES(id_destino), hash_linha=VALUES(hash_linha),"
               " hash_destino=VALUES(hash_destino), regra_recusa=VALUES(regra_recusa),"
               " gravidade_recusa=VALUES(gravidade_recusa), imagem_id=VALUES(imagem_id), alterado_em=%s,"
               " versao=versao+1" % AGORA)
        return cab, "(%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)" % AGORA, fim

    @staticmethod
    def _sql_ins(tabela, cols, com_data):
        return ("INSERT INTO `%s` (%s) VALUES " % (tabela, ", ".join("`%s`" % x for x in cols)),
                "(%s)" % ", ".join(["%s"] * (len(cols) - 1) + ["%s" if com_data else AGORA]), "")

    def _gravar_recs(self, c, recs, ordem, falhas, nivel):
        """Grava as linhas adiadas `recs` sob um SAVEPOINT; restrição do destino: desfaz e divide ao meio, até chegar
        a pedaços pequenos refeitos linha a linha (cada linha sob o SAVEPOINT dela, como na gravação sem bloco)."""
        grupos = {}
        for rec in recs:
            for tabela, cols, com_data, args in rec["ins"]:
                grupos.setdefault((tabela, cols, com_data), []).append(args)
        reg = [a for rec in recs for a in rec["reg"]]
        c.execute("SAVEPOINT bloco_conector_%d" % nivel)
        try:
            for (tabela, cols, com_data) in sorted(grupos, key=lambda k: ordem[k[0]]):
                self._sql_lote(c, *self._sql_ins(tabela, cols, com_data), grupos[(tabela, cols, com_data)])
            if reg:
                self._sql_lote(c, *self._sql_reg(), reg)
            if nivel == 0:
                self.cont["blocos_gravados"] = self.cont.get("blocos_gravados", 0) + 1
            return
        except (pymysql.err.MySQLError, _AvisoNoLote) as e:
            if not isinstance(e, _AvisoNoLote) and not (e.args and e.args[0] in carga.ERROS_LINHA):
                raise
            c.execute("ROLLBACK TO SAVEPOINT bloco_conector_%d" % nivel)
        if nivel == 0:
            self.cont["blocos_refeitos"] = self.cont.get("blocos_refeitos", 0) + 1
        if len(recs) > 16:
            meio = len(recs) // 2
            self._gravar_recs(c, recs[:meio], ordem, falhas, nivel + 1)
            self._gravar_recs(c, recs[meio:], ordem, falhas, nivel + 1)
            return
        sreg = self._sql_reg()
        for rec in recs:  # linha a linha, como na gravação sem bloco
            c.execute("SAVEPOINT linha_conector")
            i = 0
            try:
                for i, (tabela, cols, com_data, args) in enumerate(rec["ins"]):
                    cab, tupla, fim = self._sql_ins(tabela, cols, com_data)
                    c.execute(cab + tupla, args)
                i = len(rec["ins"])
                if rec["reg"]:
                    self._sql_lote(c, *sreg, rec["reg"])
            except pymysql.err.MySQLError as e:
                cod = e.args[0] if e.args and isinstance(e.args[0], int) else None
                if cod not in carga.ERROS_LINHA:
                    raise
                c.execute("ROLLBACK TO SAVEPOINT linha_conector")
                rec["falhou_em"] = i
                falhas.append((rec, cod, rec["seq"], carga.detalhe_erro(e)))

    def _esvaziar(self):
        """Grava o bloco adiado (`_gravar_recs`) e desfaz na memória só as linhas recusadas pela restrição do destino,
        que ficam recusadas com `restricao_destino_<código>` como na gravação linha a linha."""
        if not self._fila or self._esvaziando:
            return
        self._esvaziando = True
        try:
            fila, self._fila = self._fila, []
            ordem = {}  # destinos na ordem da primeira inserção (pai antes do filho dentro da linha)
            for rec in fila:
                for tabela, _, _, _ in rec["ins"]:
                    ordem.setdefault(tabela, len(ordem))
            falhas, desfeitos = [], set()
            with self.cr.cursor() as c:
                self._gravar_recs(c, fila, ordem, falhas, 0)
            falhas.sort(key=lambda x: x[2])
            for rec, _, _, _ in reversed(falhas):  # desfaz a memória da linha; do fim para o começo, os índices valem
                (d0, p0, b0), (d1, p1, b1) = rec["ini"], rec["fim"]
                for t, k, ant in reversed(self._diario[d0:d1]):
                    if ant is None:
                        self.existente[t].pop(k, None)
                    else:
                        self.existente[t][k] = ant
                del self._diario[d0:d1], self.pend[p0:p1], self._buf[b0:b1]
                for k, x in rec["dcont"].items():
                    self.cont[k] -= x
                for ent, k in rec["origem"]:
                    self.origem.get(ent, {}).pop(k, None)
                if rec["adiadas"]:
                    del self.adiadas[rec["adiadas"][0]:rec["adiadas"][1]]
                desfeitos.update((tb, a[cols.index("id")]) for tb, cols, _, a in rec["ins"][rec["falhou_em"]:])
            if desfeitos:  # filho -> pai como linha a linha: só fica o que chegou ao banco
                for (dt, _, _), lst in self._filho_pai.items():
                    lst[:] = [x for x in lst if (dt, x[0]) not in desfeitos]
            for rec, cod, _, det in falhas:
                tab, chave, entidade, h = rec["linha"]
                self.cont["recusas_por_restricao"] += 1
                self._recusar(tab, chave, entidade, h, "restricao_destino_%d" % cod, "critica", det)
                self.prop.registrar(tab, chave, self.existente[tab][chave][3] or "recusada", "critica")
            self._prox_id = {}
        finally:
            self._esvaziando = False

    def _adocao_presumida(self, p, vals):
        """ADR 0007 (18 e 20): valor presumido nunca é chave de identidade. No destino de adoção marcado `identidade`
        (a chave identifica uma pessoa), a linha cuja chave tem coluna presumida (`=~x`) e que ADOTARIA uma linha já
        gravada é recusada (`adocao_por_valor_presumido`, alta, para revisão humana), em vez de fundir duas pessoas
        por um dado inventado; sem colisão, grava a linha própria. Cadastro de configuração (tipo, plano) adota
        normalmente."""
        for dt, itens in (vals or {}).items():
            op = (p.get("opcoes") or {}).get(dt) or {}
            ad = op.get("adotar") or ()
            if not ad or not op.get("identidade") or not any((dt, a) in getattr(self, "_presumidas", ()) for a in ad):
                continue
            for _, v in itens:
                if all(v.get(a) is not None for a in ad) and self._todas(
                        "SELECT id FROM `%s` WHERE %s LIMIT 1" % (dt, " AND ".join("`%s`=%%s" % a for a in ad)),
                        tuple(v[a] for a in ad)):
                    return ("adocao_por_valor_presumido", "alta")
        return None

    def _gravar_ou_adotar(self, dt, v, adotar, complementa=False, maior=(), ativo=()):
        """(id, adotado): com `adotar`, a linha do destino que já tem as mesmas colunas (uma só) é adotada; com
        `complementa`, a linha do pai (`id` resolvido pela referência) recebe as colunas por UPDATE."""
        if complementa:
            rid = v["id"]
            cols = [c for c in v if c != "id"]
            if cols:
                with self._c() as c:
                    c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join("`%s`=%%s" % x for x in cols)),
                              [v[x] for x in cols] + [rid])
            return rid, False
        if ativo and all(v.get(a) is not None for a in ativo):
            # `adotar_ativo:` o ATIVO de menor id com estas colunas (o mesmo critério do produto) vence a adoção pelo
            # código: a configuração do cliente não é duplicada nem mesclada
            ids = self._todas("SELECT id FROM `%s` WHERE %s AND ativo ORDER BY id LIMIT 1" % (
                dt, " AND ".join("`%s`=%%s" % a for a in ativo)), tuple(v[a] for a in ativo))
            if ids:
                return ids[0][0], True
        if adotar and all(v.get(a) is not None for a in adotar):
            ids = self._todas("SELECT id FROM `%s` WHERE %s LIMIT 2" % (dt, " AND ".join("`%s`=%%s" % a for a in adotar)),
                              tuple(v[a] for a in adotar))
            if len(ids) == 1:
                maiores = [m for m in maior if v.get(m) is not None]
                if maiores:  # rodada 6: `adotar_maior:` o contador adotado fica com o MAIOR (nunca recua)
                    with self._c() as c:
                        c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join(
                            "`%s`=GREATEST(COALESCE(`%s`, %%s), %%s)" % (m, m) for m in maiores)),
                            [x for m in maiores for x in (v[m], v[m])] + [ids[0][0]])
                self._mesclar(dt, ids[0][0], {k: x for k, x in v.items() if k not in maiores})
                return ids[0][0], True
        return self._inserir(dt, v), False

    # ----- rodada 5: continuidade (ADR 0006 e 0007) -----
    def _garantir(self, nome, ddl):
        if nome not in self._criadas:
            with self._c() as c:
                c.execute(ddl)
            self._criadas.add(nome)

    def _mesclar(self, dt, rid, v):
        """Mescla NÃO destrutiva (ADR 0007, 20): coluna vazia no destino recebe a da origem; conflito mantém o
        destino e guarda o valor da origem em `historico_mescla_migracao` (pendência baixa, sem valor)."""
        cols = [k for k in v if k not in ("id", "origem") and v[k] is not None]
        if not cols:
            return
        atual = dict(zip(cols, self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
            ", ".join("`%s`" % k for k in cols), dt), (rid,))[0]))
        vazias = [k for k in cols if atual[k] is None or (isinstance(atual[k], str) and not atual[k].strip())]
        conflito = [k for k in cols if k not in vazias and canon(atual[k]) != canon(v[k])]
        with self._c() as c:
            if vazias:
                c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join("`%s`=%%s" % k for k in vazias)),
                          [v[k] for k in vazias] + [rid])
                self.cont["mescla_preenchidas"] = self.cont.get("mescla_preenchidas", 0) + len(vazias)
        if conflito:
            self._garantir("historico_mescla_migracao", continuidade.DDL_MESCLA)
            t, chave = self._linha or ("", "")
            with self._c() as c:
                for k in conflito:
                    c.execute("INSERT INTO historico_mescla_migracao (tabela_destino, registro_id, coluna, valor_origem,"
                              " tabela_origem, chave_origem, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                              " ON DUPLICATE KEY UPDATE valor_origem=VALUES(valor_origem), alterado_em=%s,"
                              " versao=versao+1" % (AGORA, AGORA), (dt, rid, k, _valor_legivel(v[k]), t, chave))
            self.cont["mescla_conflitos"] = self.cont.get("mescla_conflitos", 0) + len(conflito)
            self._pendencia(t, chave, "mescla_conflito_origem_guardada", "baixa")

    def _cofre(self, t, chave, dt, dc, bruto, pend):
        y = sentinela.aplicar("texto", bruto)[0]
        if y is None:
            return None
        env = continuidade.cifrar(self.chave_cofre, str(y)) if self.chave_cofre else None
        if env is None:
            pend.append(("segredo_aguarda_cofre", "media"))
            return None
        self._garantir("segredo_cofre", continuidade.DDL_COFRE)
        ref = continuidade.referencia_cofre(dt, dc, t, chave)
        with self._c() as c:  # já no cofre (reexecução): fica como está
            c.execute("INSERT IGNORE INTO segredo_cofre (referencia, envelope, finalidade, origem, criado_em)"
                      " VALUES (%%s,%%s,%%s,'migracao',%s)" % AGORA, (ref, env, ("%s.%s" % (dt, dc))[:60]))
        self.cont["segredos_no_cofre"] = self.cont.get("segredos_no_cofre", 0) + 1
        return ref

    def _ligar_espelho(self, esp, codigo, linha, pend):
        """Id da linha do espelho (copiada no cliente com os mesmos ids) pelo código e, com edição, pela edição;
        nunca copia conteúdo licenciado. Ausente: NULL com `espelho_codigo_inexistente`/`espelho_edicao_inexistente`."""
        cat = esp["catalogo"]
        ed = esp["edicao"] or (sentinela.aplicar("texto", linha.get(esp["edicao_coluna"]))[0]
                               if esp["edicao_coluna"] else None)
        cod = self._chave(codigo).strip()
        if cat == "cep":
            cod = re.sub(r"\D", "", cod)
        k = (cat, cod, ed)
        if k not in self._esp:
            if cat in ("brasindice", "simpro"):
                sql = "SELECT i.id FROM item_referencia_matmed i WHERE i.fonte_referencia=%s AND i.codigo_referencia=%s"
                args = [cat, cod]
                if ed:
                    sql += (" AND EXISTS (SELECT 1 FROM preco_referencia_matmed pr JOIN edicao_referencia_matmed e"
                            " ON e.id=pr.edicao_referencia_matmed_id WHERE pr.item_referencia_matmed_id=i.id"
                            " AND e.numero_edicao=%s)")
                    args.append(ed)
            elif cat == "cbhpm":
                sql = ("SELECT it.id FROM tabela_referencia_procedimento_item it JOIN tabela_referencia_procedimento tr"
                       " ON tr.id=it.tabela_referencia_procedimento_id WHERE tr.codigo_tabela='cbhpm'"
                       " AND it.codigo_procedimento=%s")
                args = [cod]
                if ed:
                    sql += " AND tr.edicao=%s"
                    args.append(ed)
                else:  # sem edição: a mais recente
                    sql += " ORDER BY tr.vigencia_inicio DESC, tr.id DESC LIMIT 1"
            else:
                sql, args = "SELECT id FROM logradouro_cep WHERE codigo_cep=%s", [cod]
            ids = [r[0] for r in self._todas(sql, tuple(args))]
            if not ids and ed:  # o código existe em outra edição?
                sem = self._ligar_espelho(dict(esp, edicao="", edicao_coluna=""), codigo, linha, [])
                self._esp[k] = ("edicao", None) if sem is not None else (None, None)
            else:
                self._esp[k] = (None, ids[0]) if len(ids) == 1 else ("ambiguo", None) if ids else (None, None)
        motivo, rid = self._esp[k]
        if rid is None:
            pend.append(("espelho_edicao_inexistente" if motivo == "edicao" else
                         "espelho_ambiguo" if motivo == "ambiguo" else "espelho_codigo_inexistente", "media"))
        return rid

    def _evidencia(self, tab, cols):
        """({chave: data mais antiga da linha}, data mais antiga da tabela) nas colunas de evidência (cache)."""
        k = (tab, tuple(cols))
        if k not in self._vig:
            por, menor = {}, None
            if cols:
                ch = self.chaves.get(tab) or []
                nomes, it = self.lt.ler_tudo(tab, colunas=list(dict.fromkeys(ch + list(cols))))
                for x in it:
                    d = dict(zip(nomes, x))
                    ds = [y for y in (continuidade.data_valida(d[c]) for c in cols) if y]
                    if ds:
                        m = min(ds)
                        por["|".join(self._chave(d[c]) for c in ch)] = m
                        menor = m if menor is None or m < menor else menor
            self._vig[k] = (por, menor)
        return self._vig[k]

    def _vigencia_origem(self):
        """Data do registro mais antigo da origem: pelas colunas de `evidencia_origem` (mapa) presentes; sem nenhuma
        presente (imagem parcial), pelas colunas de evidência de todas as tabelas da imagem e, por fim, por qualquer
        coluna de data delas."""
        if self._vig_origem is False:
            menor, presentes = None, sorted(self.lt.tabelas())

            def ver(tab, cols):
                nonlocal menor
                if cols and self.chaves.get(tab) is not None:
                    _, m = self._evidencia(tab, cols)
                    menor = m if m and (menor is None or m < menor) else menor
            for e in self.mapa_exec.get("evidencia_origem") or []:
                if e["tabela"] in presentes and e["coluna"] in {c["nome"] for c in self.lt.colunas(e["tabela"])}:
                    ver(e["tabela"], [e["coluna"]])
            for todas in (False, True):
                if menor is not None:
                    break
                for tab in presentes:
                    cs = [(c["nome"], c.get("codigo_tipo")) for c in self.lt.colunas(tab)]
                    ver(tab, [n for n, tp in cs if tp in continuidade.TIPOS_DATA] if todas
                        else continuidade.colunas_de_evidencia(cs))
            if menor is None:  # último recurso, nunca a data da carga: a criação do arquivo da origem
                try:
                    r = self.lt.consultar("SELECT MON$CREATION_DATE FROM MON$DATABASE")
                    menor = continuidade.data_valida(r[0][0]) if r else None
                except Exception:  # noqa: BLE001 (leitor sem a tabela de monitoramento)
                    menor = None
            self._vig_origem = menor
        return self._vig_origem

    def _vigencia(self, p, linha, chave, cols, pend):
        """Vigência sem data própria (ADR 0007, 16): a data mais antiga com evidência na LINHA (colunas declaradas em
        `#vigencia:A,B`, ou as de criação/início/primeiro uso do dicionário vivo); senão a do registro mais antigo da
        TABELA (pendência baixa); senão a do registro mais antigo da ORIGEM (baixa); nunca a data da carga. Sem
        nenhuma evidência: NULL com `vigencia_sem_evidencia`."""
        t = p["tabela"]
        if cols is None:
            cols = continuidade.colunas_de_evidencia(
                [(c["nome"], c.get("codigo_tipo")) for c in self.lt.colunas(t)])
        por, menor = self._evidencia(t, cols)
        if chave in por:
            return por[chave]
        if menor is not None:  # estimada sem fonte própria na linha (baixa, visível)
            pend.append(("vigencia_sem_fonte", "baixa"))
            return menor
        o = self._vigencia_origem()
        if o is not None:
            pend.append(("vigencia_sem_fonte", "baixa"))
            return o
        pend.append(("vigencia_sem_evidencia", "media"))
        return None

    def _conferir_filho_pai(self):
        """Código derivado sem perder ligação (ADR 0007, 19): cada filha gravada aponta, no destino relido, para a
        linha do pai que a origem indicava (pelo conector_origem). Só contagens."""
        res = {}
        for (dt, dc, pai), pares in sorted(self._filho_pai.items()):
            div = 0
            for i in range(0, len(pares), 1000):
                bloco = dict(pares[i:i + 1000])
                lido = dict(self._todas("SELECT id, `%s` FROM `%s` WHERE id IN (%s)" % (
                    dc, dt, ",".join(["%s"] * len(bloco))), tuple(bloco)))
                div += sum(1 for r, esperado in bloco.items() if lido.get(r) != esperado)
            res["%s.%s" % (dt, dc)] = {"pai": pai, "verificados": len(pares), "divergentes": div,
                                       "conferido": div == 0}
            if div:
                self._pendencia(pai, "*", "filho_pai_divergente", "alta")
        return res

    def _provas(self, presentes):
        """Prova de "não copiar" (ADR 0006, 1) das tabelas declaradas em `declarado/provas.tsv` presentes na origem:
        as linhas da origem (chave e valores pela regra) contra as recalculadas no destino pelo SQL da prova
        (`declarado/provas.d/<TABELA>.sql`, `{ctl}` = base de controle). Derivado: igual linha a linha; mecanismo:
        o estado carregado vale pelo menos o da origem (ex. próximo número >= último + 1)."""
        res = {}
        for pv in self.mapa_exec.get("provas") or []:
            t = pv["tabela"]
            if t not in presentes or t not in set(self.lt.tabelas()):
                continue
            ch, vs = pv["chave"], pv["valores"]
            nomes, it = self.lt.ler_tudo(t, colunas=list(dict.fromkeys(ch + [v[0] for v in vs])))
            ger = {g["coluna"]: g.get("regra") for g in self.mapa_exec.get("colunas", []) if g["tabela"] == t}
            origem = {}
            for x in it:
                d = dict(zip(nomes, x))
                k = "|".join(self._chave(d[c]).strip() for c in ch)
                origem[k] = [sentinela.aplicar(r or ger.get(col) or "texto", d[col])[0] for col, r in vs]
            destino = {}
            for r in self._todas(pv["sql"].replace("{ctl}", self.ctl)):
                destino["|".join(self._chave(x).strip() for x in r[:len(ch)])] = list(r[len(ch):])
            if pv["tipo"] == "mecanismo":  # estado: o destino vale pelo menos a origem (numérico) ou igual
                for k, ov in origem.items():
                    dv = destino.get(k)
                    if dv is not None and all(_ao_menos(a, b) for a, b in zip(dv, ov)):
                        destino[k] = ov
            o = {k: "|".join(canon(x) for x in v) for k, v in origem.items()}
            d = {k: "|".join(canon(x) for x in v) for k, v in destino.items()}
            r = continuidade.comparar(o, d)
            r["tipo"] = pv["tipo"]
            res[t] = r
            if not r["conferido"]:
                self._pendencia(t, "*", "prova_nao_conferida", "alta")
        return res

    def _nome_ent(self, t, dt):
        k = (t, dt)
        if k not in self.ent:
            nome, i = dt, 2
            while nome in self.usadas:
                nome, i = "%s#%d" % (dt, i), i + 1
            self.usadas.add(nome)
            self.ent[k] = nome
        return self.ent[k]

    # ----- carga de uma tabela -----
    def _situacao(self, tab, chave, h):
        if not self.sinc:
            return super()._situacao(tab, chave, h)
        self.vistas.setdefault(tab, set()).add(chave)
        ant = self.existente.get(tab, {}).get(chave)
        if ant is None:
            return "nova", None
        if chave in self._excluidas.get(tab, ()):
            sincronizar_mod.reativar(self, tab, chave)
        if self._retentar(tab, ant):  # CONECTOR_REPROCESSAR_RECUSADAS: a recusada é tentada de novo, como nova
            return "nova", None
        if ant[1] == h:
            ja = None
            if ant[0] is None:
                ja = ant[3] or "recusa_sem_regra_registrada"
                self._pendencia(tab, chave, ja, ant[4] or "alta")
            self._reemitir_avisos(tab, chave, ja)  # linha igual não é reprocessada: as pendências dela continuam
            self.cont["puladas_iguais"] += 1
            return "igual", ant
        if ant[0] is None:  # recusada antes e mudou na origem: tenta de novo, como linha nova
            self.cont["recusadas_retentadas"] = self.cont.get("recusadas_retentadas", 0) + 1
            return "nova", None
        return "alterada", ant

    def _tabela(self, p):
        t, dts = p["tabela"], p["destinos"]
        ents = [self._nome_ent(t, dt) for dt in dts]
        self._preparar(p)
        colide = self._colisoes(p)
        self._montar_grupos(p)
        self._montar_leituras(p)
        seqs = [c["coluna"][5:] for dt in dts for c in p["colunas"][dt] if c["coluna"].startswith("#seq:")]
        cont_seq = {}
        inicio, n = time.monotonic(), 0
        suporta = self.sinc and sincronizar_mod.suporta(self, p)
        if suporta:
            sincronizar_mod.estado_destino(self, p, ents)
        blocos = {}
        adiavel = self._adiavel(p)
        for linha, ch_sem in self._linhas_mapa(p):
            n += 1
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            for col in seqs:
                k = (col, self._chave(linha[col]))
                cont_seq[k] = cont_seq.get(k, 0) + 1
                self.seq[col] = cont_seq[k]
            h = bytes.fromhex(hash_linha([linha[c] for c in p["lidas"]]))
            if self._bloco is not None:
                blocos.setdefault(self._bloco, []).append(h)
            self._grp = self._grupos[1][chave] if self._grupos else None
            prov = self.existente.get(t, {}).get(chave)
            completar = None
            if prov and prov[0] is not None and prov[1] == carga.HASH_ZERO and PROVISORIO.get(t) == dts[0]:
                # cadastro provisório (criado pelo L3 para um atendimento antes desta tabela): a linha real o
                # COMPLETA (UPDATE do principal, mesmo id), em vez de ficar como alteração à espera do Sincronizar
                completar = prov[0]
                del self.existente[t][chave]
            sit, ant = self._situacao(t, chave, h)
            self._atualizar = None
            if sit == "alterada" and self.sinc:
                if suporta:
                    self._atualizar = ant
                else:  # estrutura que o Sincronizar ainda não reaplica (cabeçalho agrupado): visível, nunca silenciosa
                    self.cont["alteradas_aguardam"] += 1
                    self._pendencia(t, chave, "alteracao_aguarda_sincronizar", "baixa")
            if sit != "nova" and self._atualizar is None:
                if ant[0] is not None:
                    self._secundarias_ja_carregadas(p, ents, chave, sit, ant)
                elif ant[3]:
                    self.prop.registrar(t, chave, ant[3], ant[4] or "alta")
                continue
            if chave in colide:
                vals, campos, pend, recusa, adiadas = None, None, [], ("codigo_colisao_caixa", "media"), []
            else:
                pf = []  # pai do filtro inexistente/ambíguo: recusada pela regra do pai (média), nunca gravada
                fora = next((f for f in p.get("filtros") or [] if not self._cond(linha, f, pf)), None)
                if fora is not None:  # so_se: fora do filtro da carga, nunca gravada (pendência baixa, visível)
                    recusa = pf[0] if pf else (fora["regra"] or FILTRO_PADRAO, "baixa")
                    vals, campos, pend, adiadas = None, None, [], []
                else:
                    vals, campos, pend, recusa, adiadas = self._valores(p, linha, chave)
                    if not recusa:
                        recusa = self._adocao_presumida(p, vals)
                if not recusa and self._desdobrado(p, dts[0]) and not vals[dts[0]]:
                    recusa = ("sem_item_a_gravar", "baixa")  # nada a gravar: visível, conta como recusada
            if recusa and self._atualizar is not None:  # a linha antiga fica como estava, à espera da correção
                self._pendencia(t, chave, *recusa)
                self._pendencia(t, chave, "alteracao_recusada_aguarda_correcao", "media")
                self._secundarias_ja_carregadas(p, ents, chave, "alterada", self._atualizar)
                continue
            if recusa:
                if completar is not None:  # o provisório fica como estava, com a regra da linha real
                    self.existente[t][chave] = prov
                    self._pendencia(t, chave, *recusa)
                    self.cont["provisorios_nao_completados"] = self.cont.get("provisorios_nao_completados", 0) + 1
                    self.origem.setdefault(ents[0], {})[chave] = prov[2].hex() if prov[2] else "sem_resumo_gravado"
                    continue
                if os.environ.get("CONECTOR_SEM_LOTE") == "1":
                    self._recusar(t, chave, ents[0], h, *recusa)
                else:  # o registro da recusa vai no lote do bloco (nenhuma inserção no destino)
                    self._linha_adiada(t, chave, ents[0], h, lambda: self._recusar(t, chave, ents[0], h, *recusa))
                self.prop.registrar(t, chave, *recusa)
                continue
            for regra, g in pend:
                self._pendencia(t, chave, regra, g)
            hds, cabs = [], []

            def gravar():
                ids = {}
                del hds[:], cabs[:]
                ops = p.get("opcoes") or {}
                ordem = [i for i, dt in enumerate(dts) if (ops.get(dt) or {}).get("antes")]
                ordem += [i for i in range(len(dts)) if i not in ordem]
                for i in ordem:
                    dt = dts[i]
                    primeiro, itens_principal = None, i == 0 and self._desdobrado(p, dt)
                    for (suf, v), (nomes, cs) in zip(vals[dt], campos[dt]):
                        for c in p["colunas"][dt]:
                            if c["coluna"] == "@id":
                                v[c["destino"]] = ids[dts[0]]
                            elif c["coluna"].startswith("@id:"):
                                v[c["destino"]] = ids.get(c["coluna"][4:])
                        op = (p.get("opcoes") or {}).get(dt) or {}
                        agrupado = anterior = False
                        if i == 0 and completar is not None:
                            rid, adotado = self._gravar_ou_adotar(dt, dict(v, id=completar), None, True)
                            self.cont["provisorios_completados"] = self.cont.get("provisorios_completados", 0) + 1
                        elif op.get("agrupar"):  # cabeçalho do grupo: a primeira linha gravada cria, as outras usam
                            rid, anterior = self._cabecalho(t, dt, chave, i == 0)
                            agrupado, adotado = rid is not None, False
                            if not agrupado:
                                if op.get("adotar"):  # rodada 6: contador que já existe é adotado (maior vence)
                                    self._linha = (t, chave)
                                    rid, adotado = self._gravar_ou_adotar(dt, v, op["adotar"], False,
                                                                          op.get("adotar_maior") or ())
                                else:
                                    rid = self._inserir(dt, v)
                                cabs.append(((t, self._grp[0]), rid))
                        else:
                            self._linha = (t, chave)
                            kx = chave if i == 0 and not itens_principal else "%s/%s%s" % (
                                chave, dt, "/" + suf if suf else "")
                            alvo = sincronizar_mod.alvo(self, t, kx, dt, op) if self._atualizar is not None else None
                            if alvo:  # Sincronizar: a origem vence (UPDATE do mesmo id); edição do destino guardada
                                sincronizar_mod.conflito(self, t, kx, dt, alvo, nomes, v)
                                rid, adotado = sincronizar_mod.atualizar(
                                    self, dt, alvo, v, [str(x) for x in cs if isinstance(x, _PADRAO)]), False
                            elif op.get("complementa") and self._atualizar is not None and v.get("id") is not None:
                                # complementa no Sincronizar: a edição do destino nessas colunas vai ao conflito
                                sincronizar_mod.conflito(self, t, kx, dt, v["id"], nomes, v)
                                rid, adotado = sincronizar_mod.atualizar(self, dt, v["id"], v), False
                            else:
                                rid, adotado = self._gravar_ou_adotar(dt, v, op.get("adotar"), op.get("complementa"),
                                                                      ativo=op.get("adotar_ativo") or ())
                        for c in p["colunas"][dt]:  # filho -> pai de código derivado (ADR 0007, 19)
                            if c.get("pai_derivado") and v.get(c["destino"]) is not None and not adotado:
                                self._filho_pai.setdefault((dt, c["destino"], c["pai_derivado"]), []).append(
                                    (rid, v[c["destino"]]))
                        pad = [x for x in cs if isinstance(x, _PADRAO)]
                        if agrupado:  # o resumo é o cabeçalho no destino; anterior com agregado mudado: pendência
                            self.cont["agrupadas"] = self.cont.get("agrupadas", 0) + 1
                            maiores = [m for m in (op.get("adotar_maior") or ()) if v.get(m) is not None]
                            if maiores:  # rodada 6: o contador do cabeçalho já existente também só avança (Sincronizar)
                                with self._c() as c:
                                    c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join(
                                        "`%s`=GREATEST(COALESCE(`%s`, %%s), %%s)" % (m, m) for m in maiores)),
                                        [x for m in maiores for x in (v[m], v[m])] + [rid])
                            lido = list(self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                ", ".join("`%s`" % c for c in nomes), dt), (rid,))[0]) if nomes else []
                            if anterior and any(not isinstance(a, _PADRAO) and n not in maiores and canon(a) != canon(b)
                                                for n, a, b in zip(nomes, cs, lido)):
                                if self.sinc:  # a origem vence: agregados recalculados de todas as linhas lidas do grupo
                                    sincronizar_mod.atualizar(self, dt, rid, {
                                        n: x for n, x in v.items() if n not in maiores and n != "id"},
                                        [str(x) for x in cs if isinstance(x, _PADRAO)])
                                    self.sinc_res["cabecalhos_recalculados"] = self.sinc_res.get(
                                        "cabecalhos_recalculados", 0) + 1
                                    lido = list(self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                        ", ".join("`%s`" % c for c in nomes), dt), (rid,))[0])
                                else:
                                    self._pendencia(t, chave, "grupo_divergente_aguarda_sincronizar", "media")
                            cs = lido
                        elif adotado:  # nada é sobrescrito: o resumo é o que está no destino
                            self._pendencia(t, chave, "adotado_existente", "baixa")
                            self.cont["adotadas"] = self.cont.get("adotadas", 0) + 1
                            if nomes:
                                cs = list(self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                    ", ".join("`%s`" % c for c in nomes), dt), (rid,))[0])
                        elif pad:
                            self.cont["padrao_do_destino"] = self.cont.get("padrao_do_destino", 0) + len(pad)
                            lido = dict(zip(pad, self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                ", ".join("`%s`" % c for c in pad), dt), (rid,))[0]))
                            cs = [lido[x] if isinstance(x, _PADRAO) else x for x in cs]
                        hd = hashlib.sha256("|".join(canon(x) for x in cs).encode()).digest()
                        k = chave if i == 0 and not itens_principal else "%s/%s%s" % (
                            chave, dt, "/" + suf if suf else "")
                        self._registrar(t, k, dts[i] if i else ents[0], rid, h, hd)
                        hds.append((ents[i], chave + ("/" + suf if suf else ""), hd))
                        primeiro = primeiro or rid
                    if itens_principal:  # a linha: id do primeiro item, resumo dos itens (fora da soma)
                        self._registrar(t, chave, ents[0], primeiro, h, hashlib.sha256(
                            b"".join(x[2] for x in hds if x[0] == ents[0])).digest())
                    ids[dt] = primeiro
                return [ids.get(dt) for dt in dts]
            self._adiar_linha = (adiavel and sit == "nova" and self._atualizar is None and completar is None
                                 and not any(isinstance(x, _PADRAO) for dt in dts for _, cs in campos[dt] for x in cs))
            try:
                ids = self._linha_nova(t, chave, ents[0], h, gravar)
            finally:
                self._adiar_linha = False
            if ids:
                self._cab.update(cabs)
                for ent, k, hd in hds:
                    self.origem.setdefault(ent, {})[k] = hd.hex()
                a0 = len(self.adiadas)
                for dt, dc, ref, cpai in adiadas:
                    if ids[dts.index(dt)] is not None:
                        self.adiadas.append((dt, dc, ids[dts.index(dt)], ref, cpai, t, chave))
                if self._fila and self._fila[-1]["linha"][:2] == (t, chave) and "fim" in self._fila[-1]:
                    self._fila[-1]["origem"] = [(ent, k) for ent, k, _ in hds]
                    self._fila[-1]["adiadas"] = (a0, len(self.adiadas))
            elif self._atualizar is not None:  # restrição ao reaplicar: a linha antiga fica, à espera da correção
                a = self._atualizar
                self._registrar(t, chave, ents[0], a[0], a[1], a[2])
                self._secundarias_ja_carregadas(p, ents, chave, "alterada", a)
            elif completar is not None:  # restrição do destino ao completar: o provisório fica como estava
                self._registrar(t, chave, ents[0], prov[0], prov[1], prov[2])
                self.cont["provisorios_nao_completados"] = self.cont.get("provisorios_nao_completados", 0) + 1
                self.origem.setdefault(ents[0], {})[chave] = prov[2].hex() if prov[2] else "sem_resumo_gravado"
            else:
                self.prop.registrar(t, chave, self.existente[t][chave][3] or "recusada", "critica")
            if n % LOTE_COMMIT == 0:
                self._commit()
        self._atualizar = None
        if blocos:
            sincronizar_mod.blocos(self, t, blocos)
        self._commit()
        seg = time.monotonic() - inicio
        ant = self.por_tabela.get(t) if self._faixa_lim is not None else None
        if ant:  # outra faixa da mesma tabela neste gravador: soma
            n, seg = n + ant["linhas"], seg + ant["segundos"]
        self.por_tabela[t] = {"linhas": n, "segundos": round(seg, 3),
                              "linhas_por_segundo": round(n / seg, 1) if seg > 0 else None}

    @staticmethod
    def _desdobrado(p, dt):
        op = (p.get("opcoes") or {}).get(dt) or {}
        return bool(op.get("desdobrar") or op.get("por_pai"))

    def _secundarias_ja_carregadas(self, p, ents, chave, sit, ant):
        """Linha já carregada: principal e secundárias entram na soma da origem pelo que foi gravado. Opcional sem
        linha não entra; desdobrada (também no principal) entra um item por rótulo gravado."""
        t, ex = p["tabela"], self.existente.get(p["tabela"], {})
        for i, (ent, dt) in enumerate(zip(ents, p["destinos"])):
            if i == 0 and not self._desdobrado(p, dt):
                self._ja_carregada(ent, chave, sit, ant)
                continue
            base, op = "%s/%s" % (chave, dt), (p.get("opcoes") or {}).get(dt) or {}
            if op.get("desdobrar"):
                for _, rot in op["desdobrar"]:
                    if base + "/" + rot in ex:
                        self._ja_carregada(ent, chave + "/" + rot, sit, ex[base + "/" + rot])
            elif op.get("por_pai"):  # rótulos = chaves dos pais gravadas (índice montado uma vez por tabela)
                for rot in self._itens_por_pai(t, dt).get(chave, ()):
                    self._ja_carregada(ent, chave + "/" + rot, sit, ex[base + "/" + rot])
            elif op.get("opcional") or op.get("se"):
                if base in ex:
                    self._ja_carregada(ent, chave, sit, ex[base])
            else:
                self._ja_carregada(ent, chave, sit, ex.get(base) or ant)

    def _itens_por_pai(self, t, dt):
        """{chave da linha: [chave do pai]} dos itens `por_pai` já gravados (`<chave>/<dt>/<chave do pai>`)."""
        k = (t, dt)
        idx = self.__dict__.setdefault("_idx_por_pai", {})
        if k not in idx:
            m, marca = {}, "/" + dt + "/"
            for ch in self.existente.get(t, {}):
                j = ch.rfind(marca)
                if j >= 0:
                    m.setdefault(ch[:j], []).append(ch[j + len(marca):])
            idx[k] = m
        return idx[k]

    def _fase2(self):
        """Referências adiadas (autorreferência e ciclo declarado em duas fases): gravadas por UPDATE no fim."""
        feitas = set()  # colunas concorrentes adiadas: vale a primeira resolvida, na ordem declarada
        for dt, dc, rid, ref, cpai, t, chave in self.adiadas:
            if (dt, dc, rid) in feitas:
                continue
            if ref not in self.existente:
                self._carregar_existente(ref)
            ant = self.existente[ref].get(cpai)
            if ant is None or ant[0] is None:
                self.cont["fase2_pendentes"] += 1
                self._pendencia(t, chave, "pai_pendente" if ant else "pai_inexistente", "media")
                continue
            with self._c() as c:
                c.execute("UPDATE `%s` SET `%s`=%%s WHERE id=%%s" % (dt, dc), (ant[0], rid))
            feitas.add((dt, dc, rid))
            self.cont["fase2_gravadas"] += 1
        self._commit()

    # ----- execução -----
    def executar(self, presentes, contagens):
        self.plano = planejar(self.mapa_exec, presentes)
        self.tabelas = [p["tabela"] for p in self.plano]
        if not self.plano:
            return {"versao_mapa": VERSAO, "entidades": {}, "pendencias": {"total": 0, "criticas": 0, "por_regra": {}},
                    "carga": dict(self.cont, por_tabela={})}
        for p in self.plano:
            self._carregar_existente(p["tabela"])
        if self.sinc:
            sincronizar_mod.carregar_excluidas(self)
        # tabelas de continuidade garantidas ANTES da primeira linha: CREATE TABLE faz commit implícito e, no meio de
        # uma linha, apagaria o SAVEPOINT dela (rodada 6: recusa de restrição virava "SAVEPOINT does not exist")
        self._garantir("historico_mescla_migracao", continuidade.DDL_MESCLA)
        self._garantir("segredo_cofre", continuidade.DDL_COFRE)
        self.cr.commit()
        paralelo.carregar(self, contagens)  # um leitor e N gravadores (CONECTOR_GRAVADORES; 1 = ordem do plano)
        self._fase2()
        if self.sinc:
            sincronizar_mod.excluir_apagadas(self)
        sincronizar_mod.sequencias(self)
        res = self.conciliar(contagens)
        res["sincronizar"] = sincronizar_mod.resumo(self)
        res["filho_pai"] = self._conferir_filho_pai()
        res["provas"] = self._provas(presentes)
        self._gravar_provas(res)
        self._commit()
        return res

    def _gravar_provas(self, res):
        """Prova e filho -> pai entram na conciliação (entidade `prova:<TABELA>` e `filho_pai:<destino.coluna>`)."""
        linhas = [("prova:" + t, r["linhas_origem"], r["linhas_destino"],
                   r["divergentes"] + r["faltando_no_destino"] + r["sobrando_no_destino"], r["conferido"])
                  for t, r in res["provas"].items()]
        linhas += [("filho_pai:" + k, r["verificados"], r["verificados"] - r["divergentes"], r["divergentes"],
                    r["conferido"]) for k, r in res["filho_pai"].items()]
        with self._c() as c:
            for ent, ro, rd, pe, ok in linhas:
                c.execute("INSERT INTO %s.conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                          " pendencias, soma_controle, conferido, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " registros_destino=VALUES(registros_destino), pendencias=VALUES(pendencias),"
                          " conferido=VALUES(conferido), versao=versao+1" % (self.ctl, AGORA),
                          (self.eid, ent[:64], ro, rd, pe, "", ok))

    # ----- conciliação (destino relido do banco) -----
    def _destino(self, p, dt, ent, principal):
        info = self._info(dt)
        cols, vistos = [], set()
        for c in p["colunas"][dt]:
            if c["coluna"].startswith("@id") or c["coluna"].startswith("#item@") or c["destino"] in vistos or (
                    _passos_em_duas_fases(c, p) and (info.get(c["destino"]) or (True,))[0]) or (
                    not _especial(c["coluna"]) and (c["regra"] == "chave_origem" and c["referencia"] in p["duas_fases"]
                                                    and not c.get("passos") and not depara.conhecido(c["depara"]))):
                continue
            vistos.add(c["destino"])  # coluna concorrente (várias declarações): uma vez, como no resumo da origem
            cols.append(c)
        ed = "(d.versao > 1 OR d.alterado_em IS NOT NULL)" if {"versao", "alterado_em"} <= set(info) else "0"
        sel = ", ".join(["co.chave_original"] + ["d.`%s`" % c["destino"] for c in cols] + [ed])
        rs = self._todas("SELECT %s FROM %s.conector_origem co JOIN `%s` d ON d.id=co.id_destino WHERE"
                         " co.tabela_origem=%%s AND co.entidade_destino=%%s" % (sel, self.ctl, dt),
                         (p["tabela"], ent if principal else dt))
        marca = "/" + dt
        desd = principal and self._desdobrado(p, dt)
        saida = {}
        for r in rs:
            k = base = r[0]
            item = False
            if not principal or desd:
                if not principal and k.endswith(marca):
                    k = base = k[:-len(marca)]
                elif k.rfind(marca + "/") >= 0:  # item de destino desdobrado: <chave>/<dt>/<rótulo>
                    j = k.rfind(marca + "/")
                    base, k, item = k[:j], k[:j] + k[j + len(marca):], True
            # principal desdobrado: a linha (sem rótulo) só conta as linhas; os itens entram na soma
            saida[k if item or not desd else (k, "linha")] = ("|".join(canon(x) for x in r[1:-1]), bool(r[-1]),
                                                               base)
        return saida

    def conciliar(self, contagens):
        res = {}
        for p in self.plano:
            t = p["tabela"]
            vistas = self.vistas.get(t, set())
            for i, dt in enumerate(p["destinos"]):
                ent = self._nome_ent(t, dt)
                bruto = self._destino(p, dt, ent, i == 0)
                desd = i == 0 and self._desdobrado(p, dt)
                destino, apagadas, linhas = {}, 0, 0
                for k, (txt, ed, base) in bruto.items():
                    if desd and isinstance(k, tuple):  # linha do principal desdobrado
                        if base in vistas:
                            linhas += 1
                        else:
                            apagadas += 1
                            if base not in self._excluidas.get(t, ()):
                                self._pendencia(t, base, "apagada_aguarda_sincronizar", "media")
                        continue
                    if base not in vistas:
                        if i == 0 and not desd:
                            apagadas += 1
                            if k not in self._excluidas.get(t, ()):
                                self._pendencia(t, k, "apagada_aguarda_sincronizar", "media")
                        continue
                    destino[k] = (hashlib.sha256(txt.encode()).hexdigest(), ed)
                aguardam = self.aguardam.get(ent, set())
                so, sd, editados = self._conferir(ent, t, destino, vistas, aguardam)
                recusadas = sum(1 for k in vistas if self.existente.get(t, {}).get(k, (None,))[0] is None)
                lidos = int(contagens.get(t, 0))
                if desd:
                    ok = lidos == len(vistas) == linhas + recusadas and so == sd and \
                        set(self.origem.get(ent, {})) | set(aguardam) == set(destino)
                elif i == 0:
                    ok = lidos == len(vistas) == len(destino) + recusadas and so == sd
                else:
                    ok = set(self.origem.get(ent, {})) | set(aguardam) == set(destino) and so == sd
                res[ent] = {"tabela_origem": t, "registros_origem": lidos if i == 0 else len(self.origem.get(ent, {})),
                            "registros_destino": len(destino), "recusados": recusadas if i == 0 else 0,
                            "aguardam_sincronizar": len(aguardam), "editados_no_destino": editados,
                            "apagados_na_origem": apagadas, "soma_origem": so, "soma_destino": sd, "conferido": ok}
        carga.aplicar_limite_recusa(res)
        principal = {p["tabela"]: self._nome_ent(p["tabela"], p["destinos"][0]) for p in self.plano}
        por_regra = {}
        for tab, _, regra, grav, _ in self.pend:
            k = "%s:%s:%s" % (principal.get(tab, "outra"), regra, grav)
            por_regra[k] = por_regra.get(k, 0) + 1
        with self._c() as c:
            for ent, r in res.items():
                c.execute("INSERT INTO %s.conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                          " pendencias, soma_controle, conferido, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " registros_destino=VALUES(registros_destino), pendencias=VALUES(pendencias),"
                          " soma_controle=VALUES(soma_controle), conferido=VALUES(conferido), versao=versao+1"
                          % (self.ctl, AGORA),
                          (self.eid, ent, r["registros_origem"], r["registros_destino"], r["recusados"],
                           r["soma_destino"], r["conferido"]))
        return {"versao_mapa": VERSAO, "entidades": res, "pendencias": {
            "total": len(self.pend), "criticas": sum(1 for x in self.pend if x[3] == "critica"),
            "por_regra": por_regra, "por_restricao": carga.por_restricao(self.pend)},
            "carga": dict(self.cont, por_tabela=self.por_tabela)}
