#!/usr/bin/env python3
"""Gera apps/api/src/modulos/consultas/tabelas.gerado.ts (F2.2, lote 02-03).

Cada consulta somente leitura declarada (parte física de origem no código-fonte de referência, só leitura) vai para a
primeira tabela de destino que existe em db/migracoes, pelo mapa de destino da análise (uso interno). Quando várias
consultas caem na MESMA tabela, cada uma precisa de um filtro fixo que a distinga (DISCRIMINADOR, lista branca de
coluna e valor) ou de um motivo registrado de que mostram o mesmo conteúdo (MESMO_CONTEUDO, no mesmo módulo, salvo
motivo). Sem isso a consulta sai do índice (404): nunca devolve a tabela inteira.

uso: python3 -I tools/obra/gerar_tabelas_consulta.py [--conferir]
  --conferir: não grava; sai 1 se o arquivo gerado estiver diferente do que seria gerado.
"""
import collections
import csv
import glob
import os
import re
import sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ORIGEM = os.path.join(RAIZ, '..', 'new-sgh', 'packages', 'legado', 'src')
MAPA = os.path.join(RAIZ, 'docs', 'analise', 'rodada2', 'final', 'mapa-spdata.tsv')
SAIDA = os.path.join(RAIZ, 'apps', 'api', 'src', 'modulos', 'consultas', 'tabelas.gerado.ts')
NOME = re.compile(r'^[a-z][a-z0-9_]{0,63}$')


def valor(coluna, v):
    return {'coluna': coluna, 'valor': v}


def via(coluna, tabela, filtro):
    return {'coluna': coluna, 'em': {'tabela': tabela, 'filtro': filtro}}


# Filtro fixo por tabela de ORIGEM (a consulta que ela atendia). Coluna e valor do modelo próprio.
DISCRIMINADOR = {
    # registro_excluido.entidade = tabela do modelo de onde o registro saiu.
    'SIPACAGD_EXCLUSAO': valor('entidade', 'marcacao_horario'),
    'CCCADCIR_EXCLUSAO': valor('entidade', 'ato_cirurgico'),
    # dominio_contratualizacao_sus.lista (as listas do CHECK do modelo).
    'CMESCORE': valor('lista', 'escore'),
    'CMPERIODO': valor('lista', 'periodicidade'),
    'CMREDEASSIST': valor('lista', 'rede_assistencial'),
    'CMTIPOCOMPLEXIDADESP': valor('lista', 'complexidade'),
    'CMTPAFERICAO': valor('lista', 'tipo_afericao'),
    'CMTPCONTRATO': valor('lista', 'esfera'),
    'CMTPDADOS': valor('lista', 'tipo_dado'),
    'CMTPINDICADOR': valor('lista', 'tipo_indicador'),
    'CMTPITEMINDIC': valor('lista', 'tipo_item_indicador'),
    'CMTPORCAMENTO': valor('lista', 'componente_orcamento'),
    # dominio_sus.lista.
    'FAHEMOACEVASC': valor('lista', 'acesso_vascular'),
    'FAHEMOCARTRAT': valor('lista', 'caracteristica_tratamento_dialitico'),
    'FAHEMOCONTRAN': valor('lista', 'contraindicacao_transplante'),
    'FAHEMOSITTRAN': valor('lista', 'situacao_transplante'),
    'FHCLASSIFDIAG': valor('lista', 'classificacao_diagnostico'),
    'FHJUSTPACDESC': valor('lista', 'justificativa_paciente_sem_documento'),
    'FHLEITOUTITP': valor('lista', 'tipo_leito_uti'),
    # troca_internacao pelo dado trocado do tipo da troca.
    'RITRFCLI': via('tipo_troca_internacao_id', 'tipo_troca_internacao', valor('dado_trocado', 'clinica')),
    'RITRFESP': via('tipo_troca_internacao_id', 'tipo_troca_internacao', valor('dado_trocado', 'especialidade')),
    'RITRFMED': via('tipo_troca_internacao_id', 'tipo_troca_internacao',
                    valor('dado_trocado', 'profissional_responsavel')),
    # termo_terminologia_vigencia pela terminologia do termo (código do carregador oficial).
    'HTCID': via('termo_terminologia_id', 'termo_terminologia',
                 via('terminologia_id', 'terminologia', valor('codigo', 'cid10'))),
}

# A consulta é a tabela inteira de propósito (as outras da mesma tabela precisam de discriminador próprio).
GERAL = {
    'TBDIGITAR': 'todas as regras de obrigatoriedade de campo',
}

# Tabela compartilhada em que as consultas mostram o MESMO conteúdo (motivo obrigatório).
MESMO_CONTEUDO = {
    'paciente_versao': 'o retrato dos telefones é parte da versão do cadastro do paciente',
    'profissional_versao': 'o retrato dos telefones é parte da versão do cadastro do profissional',
    'faixa_referencia_versao': 'as versões das faixas de referência do exame e do elemento são a mesma série',
    'envio_prescricao_plataforma': 'cabeçalho e lançamentos do envio da prescrição digital são o mesmo envio',
    'horario_administracao_evento': 'histórico da checagem e extrato do horário são os eventos do mesmo horário',
    'situacao_problema': 'a situação do diagnóstico lançado e a do problema são a mesma lista',
    'cancelamento_marcacao': 'a marcação excluída passa a ser cancelamento da marcação (mesmo registro); a auditoria '
                             'lê os cancelamentos',
}


def ler_consultas():
    pares = []
    for f in sorted(glob.glob(os.path.join(ORIGEM, '*', 'consultas', 'lote-m14.gerado.ts'))):
        if f.endswith('.spec.ts'):
            continue
        s = open(f, encoding='utf-8').read()
        for m in re.finditer(r"publico:\s*pub\(([^)]*)\),\s*grupo:\s*'[^']*',\s*tabela:\s*'([^']+)'", s):
            a = [x.strip().strip("'") for x in m.group(1).split(',')]
            mod, rec = (a[0], a[1]) if len(a) == 2 else ('integracao', a[0])
            pares.append((f'{mod}.{rec}', m.group(2)))
    return pares


def ler_mapa():
    d = {}
    with open(MAPA, encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            if r['destino_tipo'] == 'TABELA' and r['destino']:
                d.setdefault(r['tabela'], [x.strip() for x in r['destino'].split(';') if x.strip()])
    return d


def ler_modelo():
    cols = {}
    for f in sorted(glob.glob(os.path.join(RAIZ, 'db', 'migracoes', '**', '*.sql'), recursive=True)):
        s = open(f, encoding='utf-8').read()
        for m in re.finditer(r'CREATE TABLE ([a-z0-9_]+) \((.*?)\n\)', s, re.S):
            cols[m.group(1)] = set(re.findall(r'^\s+([a-z][a-z0-9_]*)\s+[A-Z]', m.group(2), re.M))
    return cols


def conferir_filtro(f, tabela, cols, erros, k):
    if f['coluna'] not in cols.get(tabela, set()) or not NOME.match(f['coluna']):
        erros.append(f'{k}: coluna {f["coluna"]} fora de {tabela}')
    if 'em' in f:
        if f['em']['tabela'] not in cols:
            erros.append(f'{k}: tabela {f["em"]["tabela"]} fora do modelo')
        else:
            conferir_filtro(f['em']['filtro'], f['em']['tabela'], cols, erros, k)


def ts_filtro(f):
    if 'em' in f:
        return f"{{ coluna: '{f['coluna']}', em: {{ tabela: '{f['em']['tabela']}', filtro: {ts_filtro(f['em']['filtro'])} }} }}"
    return f"{{ coluna: '{f['coluna']}', valor: '{f['valor']}' }}"


def gerar():
    pares, mapa, cols = ler_consultas(), ler_mapa(), ler_modelo()
    destino = {}
    for k, o in pares:
        t = next((x for x in mapa.get(o, []) if x in cols), None)
        if t:
            destino[k] = (t, o)
    por_tabela = collections.defaultdict(list)
    for k, (t, o) in destino.items():
        por_tabela[t].append(k)
    erros, fora, linhas = [], collections.defaultdict(list), []
    for k in sorted(destino):
        t, o = destino[k]
        grupo = por_tabela[t]
        fixo = DISCRIMINADOR.get(o)
        if fixo:
            conferir_filtro(fixo, t, cols, erros, k)
            linhas.append(f"  '{k}': {{ tabela: '{t}', fixo: {ts_filtro(fixo)} }},")
        elif len(grupo) == 1 or o in GERAL or t in MESMO_CONTEUDO:
            if t in MESMO_CONTEUDO and len({g.split('.')[0] for g in grupo}) > 1 and t != 'cancelamento_marcacao':
                erros.append(f'{k}: {t} em módulos diferentes sem motivo')
            linhas.append(f"  '{k}': {{ tabela: '{t}' }},")
        else:
            fora[t].append(k)
    if erros:
        sys.exit('\n'.join(erros))
    total_fora = sum(len(v) for v in fora.values())
    sem_destino = len(pares) - len(destino)
    cab = [
        '// GERADO por tools/obra/gerar_tabelas_consulta.py (F2.2, lote 02-03). Não editar à mão: rode o gerador.',
        '// A tabela do modelo próprio que atende cada consulta somente leitura declarada em @sgh/contratos, pelo mapa de',
        '// destino da análise do modelo (uso interno). Tabela compartilhada por várias consultas: cada uma leva o filtro',
        '// fixo que a distingue (`fixo`, coluna e valor de lista branca) ou mostra o mesmo conteúdo, com motivo no gerador.',
        f'// {len(linhas)} consultas no índice; {sem_destino} sem destino no modelo e {total_fora} em tabela compartilhada sem',
        '// discriminador definido ficam fora do índice (404), em vez de devolver a tabela inteira:',
    ]
    for t in sorted(fora):
        cab.append(f'//   {t}: {len(fora[t])}')
    corpo = [
        "import type { DestinoConsulta } from './declaracao.js';",
        '',
        'export const DESTINOS_CONSULTA: Readonly<Record<string, DestinoConsulta>> = Object.freeze({',
        *linhas,
        '});',
        '',
    ]
    return '\n'.join(cab + corpo)


if __name__ == '__main__':
    novo = gerar()
    if '--conferir' in sys.argv:
        atual = open(SAIDA, encoding='utf-8').read() if os.path.exists(SAIDA) else ''
        sys.exit(0 if atual == novo else 1)
    open(SAIDA, 'w', encoding='utf-8').write(novo)
    print(SAIDA, novo.count("tabela: '") - 0, 'linhas')
