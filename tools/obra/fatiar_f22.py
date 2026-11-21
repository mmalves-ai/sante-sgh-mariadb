#!/usr/bin/env python3
# Fatiador da F2.2/F2.3 (migração dos módulos da API e do worker para portas próprias sobre o @sgh/nucleo).
# Determinístico: só lê código, o DDL (db/migracoes) e o catálogo compacto; não abre banco nem .env.
#
# Uso: python3 -I tools/obra/fatiar_f22.py [--so-medir]
# Saídas (em docs/obra/fatias/f22/):
#   unidades.tsv  por unidade (módulo): arquivos, com legado, símbolos, portas, dependências, onda;
#   indice.tsv    por lote: onda, unidades, arquivos, com legado, tabelas-alvo, registrar;
#   <onda>-<lote>.md     a fatia autossuficiente do agente (regra 18 do protocolo);
#   <onda>-<lote>.lista  a lista de arquivos que o tools/obra/conferir-lote-f22.sh confere.
# Saída no terminal: só contagens.
import collections
import json
import math
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = os.path.join(RAIZ, 'docs/obra/fatias/f22')
API = 'apps/api/src'
MOD = 'apps/api/src/modulos'
WORKER = 'apps/worker/src'
LOTE_MIN, LOTE_MAX = 15, 40
DDL_COMPLETO, DDL_NOMES = 14, 30
SEMENTES = ['cadastro', 'recepcao', 'atendimento', 'agenda']  # portão: paciente -> atendimento

RX_IMP = re.compile(r"""(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)""", re.S)
RX_EXPORTA = re.compile(r'^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z0-9_$]+)', re.M)
RX_PORTA_IF = re.compile(r'^export\s+(?:interface|abstract class|class|type)\s+(Porta[A-Za-z0-9_]*|Fonte[A-Za-z0-9_]*|Repositorio[A-Za-z0-9_]*)', re.M)

# Áreas do DDL (catálogo) mais prováveis por módulo; só desempata e filtra o casamento por nome.
AREAS = {
    'acesso': 'ADM SIS', 'administracao': 'ADM SIS CAD', 'adt': 'INT', 'agenda': 'AGE CAD', 'assinatura': 'PEP ADM',
    'atendimento': 'REC CAD', 'cadastro': 'CAD', 'carga': 'SIS', 'catalogos': 'CAD FAT SUS', 'cirurgia': 'CC',
    'coexistencia': 'SIS', 'config': 'SIS ADM CAD', 'consultas': 'REL', 'contabil': 'FIN', 'contratualizacao': 'FAT SUS',
    'custos': 'FIN', 'digitalizacao': 'PEP', 'documento': 'PEP ADM', 'enfermagem': 'PEP INT', 'especialidades': 'PEP',
    'exames': 'SADT', 'farmacia': 'SUP', 'faturamento': 'FAT', 'financeiro': 'FIN', 'implantacao': 'SIS ADM',
    'integracao': 'INTG', 'internacao': 'INT', 'manutencao': 'HOT', 'nutricao': 'HOT', 'operadora': 'SGO',
    'orcamento': 'FAT', 'patrimonio': 'HOT FIN', 'pep': 'PEP', 'pessoas': 'RH', 'portal-medico': 'INTG PEP',
    'portal-paciente': 'INTG AGE', 'portaria': 'HOT REC', 'precos': 'FAT', 'qualidade': 'QUA', 'recepcao': 'REC AGE',
    'rede': 'CAD ADM', 'relatorio': 'REL', 'repasse': 'FAT', 'rouparia': 'HOT', 'sadt': 'SADT', 'sessoes': 'ADM',
    'suporte': 'ADM SIS', 'suprimentos': 'SUP', 'sus': 'SUS', 'telemedicina': 'INTG PEP', 'tiss': 'FAT',
}
# Tabelas que a unidade usa com certeza (o portão e o que ele exige).
FIXAS = {
    'cadastro': 'paciente paciente_versao profissional profissional_especialidade estabelecimento fonte_pagadora '
                'plano_fonte_pagadora cobertura_paciente',
    'atendimento': 'atendimento atendimento_situacao_historico atendimento_procedimento cobertura_atendimento '
                   'atendimento_pendencia',
    'recepcao': 'atendimento atendimento_senha atendimento_responsavel_historico cobertura_atendimento',
    'agenda': 'agenda_escala agenda_servico agenda_recurso agenda_fonte_pagadora',
}
SINONIMOS = {
    'convenio': ['fonte', 'pagadora'], 'convenios': ['fonte', 'pagadora'], 'medico': ['profissional'],
    'medicos': ['profissional'], 'prestador': ['profissional'], 'hospital': ['estabelecimento'],
    'empresa': ['estabelecimento'], 'colaborador': ['colaborador', 'funcionario'], 'funcionario': ['colaborador'],
    'prontuario': ['registro', 'prontuario'], 'cirurgico': ['cirurgia'], 'exames': ['exame'],
}
PARADAS = set('''ler lido lida lidos lidas gravar gravado gravada gravados listar lista listagem buscar obter criar novo
nova porta legado legada legados sgh linha linhas para por com dos das de do da tipo tipos dados entrada saida resultado
opcoes erro erros contexto fonte chave chaves valor valores versao codigo nome nomes total todos todas como sem mais
geral alterar excluir incluir registrar atualizar consultar filtro filtros pagina item itens estado parametros parametro
regra regras sql spdata firebird nativo driver gravacao leitura escrita operacao operacoes the get set from to has
memoria fake teste dto view campo campos coluna colunas'''.split())
# Símbolos do legado com nome novo ou sem equivalente no @sgh/nucleo (o resto do nome igual troca só o import).
RENOMEADOS = {
    'NucleoLegado': 'NucleoProprio', 'criarDriverNativo': '(sai: driver do Firebird)', 'somenteSgh': '(sai: avaliar)',
    'FonteCatalogo': '(porta própria do catálogo)', 'lerCodigos': '(sai: configuração do SPDATA)',
    'escritasDaTransacao': '(EscritaRegistrada / Executor)', 'ChaveGravada': '(tipo do Executor do núcleo)',
    'PrerequisitoGravado': '(tipo do Executor do núcleo)', 'operacao': 'definirOperacao (@sgh/nucleo)',
}


def ler(p):
    with open(os.path.join(RAIZ, p), encoding='utf-8', errors='replace') as h:
        return h.read()


def ts_em(pasta):
    base = os.path.join(RAIZ, pasta)
    saida = []
    for d, ds, fs in os.walk(base):
        ds[:] = sorted(x for x in ds if x not in ('node_modules', 'dist'))
        for f in sorted(fs):
            if f.endswith('.ts') or f.endswith('.tsx'):
                saida.append(os.path.relpath(os.path.join(d, f), RAIZ))
    return saida


def tokens(nome):
    partes = re.findall(r'[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])', nome)
    saida = []
    for p in (x.lower() for x in partes):
        if len(p) < 4 or p in PARADAS or p.isdigit():
            continue
        saida.append(p)
        if p.endswith('ais'):
            saida.append(p[:-3] + 'al')
        elif p.endswith('oes'):
            saida.append(p[:-3] + 'ao')
        elif p.endswith('s'):
            saida.append(p[:-1])
        saida.extend(SINONIMOS.get(p, []))
    return saida


def analisar(arq):
    """imports de um arquivo: relativos resolvidos, símbolos do legado e dos contratos."""
    s = ler(arq)
    rel, relnomes, leg, contr, pac = [], [], [], [], set()
    for m in RX_IMP.finditer(s):
        nomes, alvo = m.group(2) or '', m.group(3) or m.group(4)
        if alvo.startswith('.'):
            q = os.path.normpath(os.path.join(os.path.dirname(arq), alvo))
            q = q[:-3] + '.ts' if q.endswith('.js') else q
            if not q.endswith('.ts') and os.path.exists(os.path.join(RAIZ, q + '.ts')):
                q += '.ts'
            rel.append(q)
            mm = re.search(r'\{([^}]*)\}', nomes)
            ns = [re.sub(r'^\s*type\s+', '', n).strip().split(' as ')[0].strip() for n in mm.group(1).split(',')] if mm else []
            relnomes.append((q, [n for n in ns if n] or ['*'], m.group(0).lstrip().startswith('export')))
            continue
        if not alvo.startswith('@sgh/'):
            continue
        pac.add(alvo)
        lista = []
        mm = re.search(r'\{([^}]*)\}', nomes)
        if mm:
            for n in mm.group(1).split(','):
                n = re.sub(r'^\s*type\s+', '', n).strip()
                n = n.split(' as ')[0].strip()
                if n:
                    lista.append(n)
        elif '* as' in nomes:
            lista.append('* (namespace)')
        if alvo == '@sgh/legado' or alvo.startswith('@sgh/legado/'):
            leg.extend((n if alvo == '@sgh/legado' else f'{n} [{alvo}]') for n in (lista or ['(import sem nome)']))
        elif alvo.startswith('@sgh/contratos'):
            contr.extend((alvo, n) for n in lista)
    return {'rel': rel, 'relnomes': relnomes, 'leg': leg, 'contr': contr, 'pac': sorted(pac)}


def unidade_de(arq, login):
    if arq == 'apps/api/src/app.module.ts':  # o boot antigo: desmontado no fim
        return 'api-desmontagem'
    if arq in login:  # fecho do login (F2-L): já migrado, é a base
        return None
    if arq.startswith(MOD + '/'):
        resto = arq[len(MOD) + 1:]
        return resto.split('/')[0] if '/' in resto else None
    if arq.startswith(API + '/'):
        return 'api-raiz'
    if arq.startswith(WORKER + '/'):
        resto = arq[len(WORKER) + 1:]
        return 'worker-' + resto.split('/')[0] if '/' in resto else 'worker-raiz'
    if arq.startswith('packages/testes/src/'):
        resto = arq[len('packages/testes/src/'):]
        return 'testes-' + (resto.split('/')[0] if '/' in resto else 'raiz')
    if arq.startswith('tools/'):
        return 'tools-' + arq.split('/')[1]
    return None


def carregar_ddl():
    cat = {}
    for linha in ler('docs/obra/fatias/ddl/catalogo-compacto.tsv').splitlines():
        c = linha.split('\t')
        if len(c) >= 3:
            cat[c[0]] = (c[1], c[2])
    criar, chaves = {}, collections.defaultdict(list)
    base = os.path.join(RAIZ, 'db/migracoes')
    for pasta in sorted(os.listdir(base)):
        for f in sorted(os.listdir(os.path.join(base, pasta))):
            p = f'db/migracoes/{pasta}/{f}'
            linhas = ler(p).splitlines()
            if f.endswith('_tabelas.sql'):
                i = 0
                while i < len(linhas):
                    m = re.match(r'CREATE TABLE\s+`?([a-z0-9_]+)`?', linhas[i])
                    if m:
                        j = i
                        while j < len(linhas) and not re.match(r'^\)', linhas[j]):
                            j += 1
                        criar[m.group(1)] = (f'{p}:{i + 1}', '\n'.join(linhas[i:j + 1]))
                        i = j
                    i += 1
            elif f.endswith('_chaves.sql'):
                i = 0
                while i < len(linhas):
                    m = re.match(r'ALTER TABLE\s+`?([a-z0-9_]+)`?', linhas[i])
                    if m:
                        j = i
                        while j < len(linhas) and not linhas[j].rstrip().endswith(';'):
                            j += 1
                        chaves[m.group(1)].append('\n'.join(linhas[i:j + 1]))
                        i = j
                    i += 1
    return cat, criar, chaves


def indice_contratos():
    idx = {}
    for arq in ts_em('packages/contratos/src'):
        if arq.endswith('.spec.ts') or arq.endswith('/index.ts'):
            continue
        for n in RX_EXPORTA.findall(ler(arq)):
            idx.setdefault(n, arq)
    return idx


def tabelas_alvo(unidade, cont_tokens, cat):
    nome_mod = unidade.split('-', 1)[1] if unidade.startswith(('worker-', 'testes-', 'tools-')) else unidade
    areas = set(AREAS.get(nome_mod, '').split())
    fixas = FIXAS.get(nome_mod, '').split()
    peso = {t: math.log(1 + n) for t, n in cont_tokens.items()}
    for t in tokens(nome_mod.replace('-', ' ').title().replace(' ', '')):
        peso[t] = peso.get(t, 0) + 2.0
    res = []
    for tab, (area, _tipo) in cat.items():
        tt = tab.split('_')
        if tt[0] not in peso:
            continue
        casados = [t for t in set(tt) if t in peso]
        if area not in areas and len(casados) < 2:
            continue
        nota = sum(peso[t] for t in casados) + (1.5 if area in areas else 0) - 0.15 * (len(tt) - len(casados))
        res.append((round(nota, 2), tab))
    res.sort(key=lambda x: (-x[0], x[1]))
    ordem = [t for t in fixas if t in cat] + [t for _, t in res if t not in fixas]
    notas = dict((t, n) for n, t in res)
    return [(t, notas.get(t, 99.0)) for t in ordem]


def grupo_interno(arq, unidade):
    """subgrupo para dividir uma unidade grande: subpasta, ou prefixo do nome do arquivo."""
    if unidade.startswith(('worker-', 'testes-', 'tools-', 'api-raiz')):
        return os.path.basename(arq).split('.')[0].split('-')[0]
    resto = arq[len(MOD) + 1 + len(unidade) + 1:]
    if '/' in resto and resto.split('/')[0] not in ('aplicacao', 'infra', 'api', 'dominio'):
        return resto.split('/')[0]
    return os.path.basename(arq).split('.')[0].split('-')[0]


def blocos(arqs, unidade):
    if len(arqs) <= LOTE_MAX:
        return [arqs]
    grupos = collections.OrderedDict()
    for a in sorted(arqs, key=lambda x: (grupo_interno(x, unidade), x)):
        grupos.setdefault(grupo_interno(a, unidade), []).append(a)
    saida, atual = [], []
    for _g, fs in grupos.items():
        while len(fs) > LOTE_MAX:
            if atual:
                saida.append(atual)
                atual = []
            saida.append(fs[:LOTE_MAX])
            fs = fs[LOTE_MAX:]
        if len(atual) + len(fs) > LOTE_MAX:
            saida.append(atual)
            atual = []
        atual = atual + fs
    if atual:
        if saida and len(atual) < LOTE_MIN and len(saida[-1]) + len(atual) <= LOTE_MAX + 5:
            saida[-1] = saida[-1] + atual
        else:
            saida.append(atual)
    return saida


def tarjan(nos, arestas):
    indice, baixo, pilha, na_pilha, comps, cont = {}, {}, [], set(), [], [0]
    sys.setrecursionlimit(10000)

    def visita(v):
        indice[v] = baixo[v] = cont[0]
        cont[0] += 1
        pilha.append(v)
        na_pilha.add(v)
        for w in sorted(arestas.get(v, ())):
            if w not in indice:
                visita(w)
                baixo[v] = min(baixo[v], baixo[w])
            elif w in na_pilha:
                baixo[v] = min(baixo[v], indice[w])
        if baixo[v] == indice[v]:
            c = []
            while True:
                w = pilha.pop()
                na_pilha.discard(w)
                c.append(w)
                if w == v:
                    break
            comps.append(sorted(c))

    for v in sorted(nos):
        if v not in indice:
            visita(v)
    return comps


def main(argv):
    so_medir = '--so-medir' in argv
    cat, criar, chaves = carregar_ddl()
    contratos = indice_contratos()
    from_nucleo = set()
    for arq in ts_em('packages/nucleo/src'):
        from_nucleo.update(RX_EXPORTA.findall(ler(arq)))

    todos = ts_em(API) + ts_em(WORKER) + ts_em('packages/testes/src') + ts_em('tools')
    info = {a: analisar(a) for a in todos}
    tem_leg = {a for a, i in info.items() if i['leg']}
    # fecho do login (transitivo, a partir de tsconfig.login.json): a base já migrada
    login, fila = set(), ['apps/api/' + f for f in json.loads(ler('apps/api/tsconfig.login.json'))['files']]
    while fila:
        f = fila.pop()
        if f in login or f not in info:
            continue
        login.add(f)
        fila.extend(info[f]['rel'])
    unid = {}
    for a in todos:
        u = unidade_de(a, login)
        if u:
            unid[a] = u
    # unidades fora da API e do worker entram só com os arquivos que têm legado; as de worker/testes/tools, só se houver
    por_u = collections.defaultdict(list)
    for a, u in unid.items():
        if u.startswith(('testes-', 'tools-')) and a not in tem_leg:
            continue
        por_u[u].append(a)
    com_leg_u = {u for u, fs in por_u.items() if any(f in tem_leg for f in fs)}
    por_u = {u: sorted(fs) for u, fs in por_u.items() if u in com_leg_u}

    # alcance do legado por arquivo (fecho de imports relativos)
    memo = {}

    def alcanca(a):
        if a in memo:
            return memo[a]
        vistos, fila, achou = set(), [a], False
        while fila:
            f = fila.pop()
            if f in vistos or f not in info:
                continue
            vistos.add(f)
            if f in tem_leg:
                achou = True
                break
            fila.extend(info[f]['rel'])
        memo[a] = achou
        return achou

    def origens(arq, nome, prof=0):
        """arquivos que de fato definem `nome` importado de `arq` (segue os barris de reexportação)."""
        if prof > 6 or arq not in info:
            return {arq}
        if nome == '*':
            return {arq}
        s = ler(arq)
        if re.search(r'^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+'
                     + re.escape(nome) + r'\b', s, re.M):
            return {arq}
        achou = set()
        for alvo, ns, reexp in info[arq]['relnomes']:
            if reexp and (nome in ns or ns == ['*']):
                o = origens(alvo, nome, prof + 1)
                if ns == ['*'] and o == {alvo} and not re.search(r'\b' + re.escape(nome) + r'\b', ler(alvo) if alvo in info else ''):
                    continue
                achou |= o
        return achou or {arq}

    alvo_arqs = {a for fs in por_u.values() for a in fs}
    finais = {u for u in por_u if u.startswith(('worker-', 'testes-', 'tools-')) or u == 'api-desmontagem'}

    def fecho_alvo(iniciais):
        v, fila = set(), list(iniciais)
        while fila:
            x = fila.pop()
            if x in v or x not in alvo_arqs or unid[x] in finais:
                continue
            v.add(x)
            fila.extend(info[x]['rel'])
        return v

    # onda 1 (portão): todos os arquivos das sementes e o fecho de imports deles (as "pontes" de outros módulos)
    onda_arq = {a: 1 for a in fecho_alvo([a for u in SEMENTES if u in por_u for a in por_u[u]])}
    resto_arqs = {a for a in alvo_arqs if a not in onda_arq and unid[a] not in finais}
    memo_r = {}

    def alcanca_r(a):  # alcança o legado só por arquivos ainda não migrados
        if a not in memo_r:
            vistos, fila, achou = set(), [a], False
            while fila:
                f = fila.pop()
                if f in vistos or f not in resto_arqs:
                    continue
                vistos.add(f)
                if f in tem_leg:
                    achou = True
                    break
                fila.extend(info[f]['rel'])
            memo_r[a] = achou
        return memo_r[a]

    dep = collections.defaultdict(collections.Counter)  # u -> {v: n imports}
    dura = collections.defaultdict(set)
    ponte = collections.defaultdict(set)  # (u, v) -> arquivos de v que puxam o legado para u
    for a in sorted(alvo_arqs):
        u = unid[a]
        for alvo, ns, _r in info[a]['relnomes']:
            v = unid.get(alvo)
            if not v or v == u or alvo not in alvo_arqs:
                continue
            dep[u][v] += 1
            if a in resto_arqs:
                fontes = set().union(*(origens(alvo, n) for n in ns))
                puxam = {x for x in fontes if x in resto_arqs and alcanca_r(x)}
                if puxam:
                    dura[u].add(v)
                    ponte[(u, v)].update(puxam)

    resto = {unid[a] for a in resto_arqs}
    comps = tarjan(resto, {u: dura[u] & resto for u in resto})
    comp_de = {u: i for i, c in enumerate(comps) for u in c}
    nivel = {}
    for i, c in enumerate(comps):  # Tarjan devolve em ordem topológica reversa (dependências primeiro)
        nivel[i] = max([nivel[comp_de[v]] + 1 for u in c for v in dura[u] & resto if comp_de[v] != i] or [0])
    for a in resto_arqs:
        onda_arq[a] = 2 + nivel[comp_de[unid[a]]]
    ultima = max(onda_arq.values()) + 1
    for a in alvo_arqs:
        if unid[a] in finais:
            onda_arq[a] = ultima
    onda1 = {unid[a] for a, o in onda_arq.items() if o == 1}
    onda = {u: min(onda_arq[a] for a in fs) for u, fs in por_u.items()}
    ciclos = [c for c in comps if len(c) > 1]

    # lotes: por onda; unidades grandes divididas, pequenas juntadas (ordem: sementes, depois alfabética)
    lotes = []
    for o in sorted(set(onda_arq.values())):
        us = sorted({unid[a] for a, x in onda_arq.items() if x == o},
                    key=lambda u: (u not in SEMENTES, SEMENTES.index(u) if u in SEMENTES else 0, u))
        pend = []
        n_lote = 0

        def fecha(itens):
            nonlocal n_lote
            n_lote += 1
            lotes.append({'id': f'{o:02d}-{n_lote:02d}', 'onda': o, 'itens': itens})

        for u in us:
            bs = blocos([a for a in por_u[u] if onda_arq[a] == o], u)
            for b in bs:
                if len(bs) > 1 or len(b) >= LOTE_MIN:
                    fecha([(u, b)])
                    continue
                if pend and sum(len(x[1]) for x in pend) + len(b) > LOTE_MAX:
                    fecha(pend)
                    pend = []
                pend.append((u, b))
                if sum(len(x[1]) for x in pend) >= LOTE_MIN:
                    fecha(pend)
                    pend = []
        if pend:
            ult = lotes[-1] if lotes and lotes[-1]['onda'] == o else None
            tam = sum(len(x[1]) for x in pend)
            if ult and tam < LOTE_MIN and sum(len(x[1]) for x in ult['itens']) + tam <= LOTE_MAX + 5:
                ult['itens'] = ult['itens'] + pend
            else:
                fecha(pend)
    ultimo_lote = {}
    for l in lotes:
        for u, _b in l['itens']:
            ultimo_lote[u] = l['id']
    for l in lotes:
        l['itens'] = [(u, b, ultimo_lote[u] == l['id']) for u, b in l['itens']]
    # ordem dentro da onda: lote A depende de B se importa de B um arquivo que ainda alcança o legado
    lote_de = {a: l['id'] for l in lotes for _u, b, _f in l['itens'] for a in b}
    dep_lote = collections.defaultdict(set)
    for a, li in lote_de.items():
        for alvo in info[a]['rel']:
            lj = lote_de.get(alvo)
            if lj and lj != li and lj[:2] == li[:2] and alcanca(alvo):
                dep_lote[li].add(lj)
    ciclos_lote = []
    for o in sorted(set(onda_arq.values())):
        ids = [l['id'] for l in lotes if l['onda'] == o]
        cs = tarjan(ids, {i: dep_lote[i] for i in ids})
        cd = {i: k for k, c in enumerate(cs) for i in c}
        nv = {}
        for k, c in enumerate(cs):
            nv[k] = max([nv[cd[j]] + 1 for i in c for j in dep_lote[i] if cd[j] != k] or [0])
        for l in lotes:
            if l['onda'] == o:
                l['passo'] = nv[cd[l['id']]] + 1
                l['ciclo'] = next((c for c in cs if l['id'] in c and len(c) > 1), [])
        ciclos_lote += [c for c in cs if len(c) > 1]

    # medições por unidade
    os.makedirs(SAIDA, exist_ok=True)
    linhas_u = ['unidade\tonda\tarquivos\tcom_legado\tsimbolos_legado\tportas\tdepende_de(duras*)\ttabelas_top5']
    sim_u, tab_u = {}, {}
    for u in sorted(por_u, key=lambda x: (onda[x], x)):
        sims = collections.Counter(s for a in por_u[u] for s in info[a]['leg'])
        sim_u[u] = sims
        dom = collections.Counter()
        for s, n in sims.items():
            nome = s.split(' [')[0]
            if nome not in from_nucleo and nome not in RENOMEADOS:
                for t in tokens(nome):
                    dom[t] += n
        for a in por_u[u]:
            if re.search(r'(porta|fonte|repositorio)', os.path.basename(a)) and not a.endswith('spec.ts'):
                for t in tokens(os.path.basename(a).split('.')[0].replace('-', ' ').title().replace(' ', '')):
                    dom[t] += 1
        tab_u[u] = tabelas_alvo(u, dom, cat)
        portas = [a for a in por_u[u] if re.search(r'(porta|fonte|repositorio)', os.path.basename(a)) and 'spec' not in a]
        deps = ','.join(f"{v}{'*' if v in dura[u] else ''}:{n}" for v, n in sorted(dep[u].items()))
        linhas_u.append(f"{u}\t{onda[u]}\t{len(por_u[u])}\t{sum(1 for a in por_u[u] if a in tem_leg)}\t{len(sims)}\t"
                        f"{len(portas)}\t{deps or '-'}\t{','.join(t for t, _ in tab_u[u][:5])}")

    total_arqs = sum(len(fs) for fs in por_u.values())
    total_leg = sum(1 for fs in por_u.values() for a in fs if a in tem_leg)
    print(f'unidades {len(por_u)}; arquivos {total_arqs}; com legado {total_leg}; ondas {len(set(onda.values()))}; '
          f'lotes {len(lotes)}; ciclos de unidades {ciclos}; ciclos de lotes {ciclos_lote}')
    for o in sorted(set(onda.values())):
        ls = [l for l in lotes if l['onda'] == o]
        print(f"onda {o}: {len(ls)} lotes em {max(l['passo'] for l in ls)} passos, {sum(len(b) for l in ls for _, b, _ in l['itens'])} arquivos: "
              + ' '.join(sorted({u for l in ls for u, _, _ in l['itens']})))
    if '--pontes' in argv:  # por que a onda 1 cresce: arquivos de outra unidade que puxam o legado
        for (u, v), fs in sorted(ponte.items()):
            if True:
                print(f'ponte {u} -> {v}: ' + ' '.join(sorted(x.replace(MOD + '/', '') for x in fs))[:300])
    if so_medir:
        return 0

    with open(os.path.join(SAIDA, 'unidades.tsv'), 'w', encoding='utf-8') as h:
        h.write('\n'.join(linhas_u) + '\n')
    for f in os.listdir(SAIDA):
        if re.match(r'^\d\d-\d\d\.(md|lista)$', f):
            os.remove(os.path.join(SAIDA, f))
    rev = collections.defaultdict(set)
    for u, vs in dep.items():
        for v in vs:
            rev[v].add(u)

    idx = ['lote\tonda\tpasso\tdepende_de_lotes\tunidades\tarquivos\tcom_legado\tsimbolos\ttabelas\tregistrar']
    for l in lotes:
        arqs = [a for _, b, _ in l['itens'] for a in b]
        us = [u for u, _, _ in l['itens']]
        registrar = sorted({u for u, _, ult in l['itens'] if ult and u in AREAS})
        sims = collections.Counter(s for a in arqs for s in info[a]['leg'])
        nuc = sorted((s, n) for s, n in sims.items() if s.split(' [')[0] in from_nucleo and s not in RENOMEADOS)
        ren = sorted((s, n, RENOMEADOS[s.split(' [')[0]]) for s, n in sims.items() if s.split(' [')[0] in RENOMEADOS)
        domi = sorted(((s, n) for s, n in sims.items()
                       if s.split(' [')[0] not in from_nucleo and s.split(' [')[0] not in RENOMEADOS),
                      key=lambda x: (-x[1], x[0]))
        tabs = []  # as fixas de cada unidade primeiro; depois uma de cada unidade por vez
        for u in dict.fromkeys(us):
            for t in FIXAS.get(u, '').split():
                if t in cat and t not in [x[0] for x in tabs]:
                    tabs.append((t, 99.0))
        filas = [list(tab_u[u]) for u in dict.fromkeys(us)]
        while any(filas):
            for fl in filas:
                while fl:
                    t, nota = fl.pop(0)
                    if t not in [x[0] for x in tabs]:
                        tabs.append((t, nota))
                        break
        # numa unidade dividida em lotes, as tabelas seguem as mesmas; o recorte do lote vem dos símbolos do lote
        dom = collections.Counter()
        for s, n in domi:
            for t in tokens(s.split(' [')[0]):
                dom[t] += n
        if len({u for u in us}) == 1 and len(blocos(por_u[us[0]], us[0])) > 1:
            proprias = [t for t, _ in tabelas_alvo(us[0], dom, cat)][:DDL_COMPLETO]
            tabs = [(t, 0) for t in proprias] + [x for x in tabs if x[0] not in proprias]
        completas = [t for t, _ in tabs[:DDL_COMPLETO] if t in criar]
        nomes = [t for t, _ in tabs[DDL_COMPLETO:DDL_COMPLETO + DDL_NOMES]]
        especs = [a for a in arqs if a.endswith('.spec.ts')]
        contr = collections.defaultdict(set)
        for a in arqs:
            for alvo, n in info[a]['contr']:
                contr[contratos.get(n, alvo)].add(n)
        portas = []
        for a in arqs:
            if 'spec' in a:
                continue
            for n in RX_PORTA_IF.findall(ler(a)):
                portas.append((a, n))
        deps_l, onda_dep = collections.Counter(), {}
        for a in arqs:
            for alvo in info[a]['rel']:
                v = unid.get(alvo)
                if v and alvo in onda_arq and alvo not in arqs and v not in us:
                    deps_l[v] += 1
                    onda_dep[v] = max(onda_dep.get(v, 0), onda_arq[alvo])
        quem = sorted({w for u in us for w in rev[u]} - set(us))
        pastas = sorted({os.path.dirname(a) for a in arqs})

        with open(os.path.join(SAIDA, l['id'] + '.lista'), 'w', encoding='utf-8') as h:
            h.write(f"# lote {l['id']} (onda {l['onda']}); gerado por tools/obra/fatiar_f22.py\n")
            h.write('# registrar: ' + (' '.join(registrar) or '-') + '\n')
            h.write('# pastas: ' + ' '.join(pastas) + '\n')
            h.write('\n'.join(arqs) + '\n')

        o = []
        o.append(f"# Fatia F2.2/F2.3 — lote {l['id']} (onda {l['onda']})\n")
        o.append('Gerada por `python3 -I tools/obra/fatiar_f22.py`. Leia antes o `docs/obra/fatias/f22/brief.md`. '
                 'Tudo o que este lote precisa está aqui; não varra outros módulos.\n')
        o.append(f"- **Unidades:** {', '.join(dict.fromkeys(us))}"
                 + ('' if l['onda'] != 1 or all(u in SEMENTES for u in us) else
                    ' (pontes do portão: migre só os arquivos listados; o resto do módulo vem em onda posterior)'))
        o.append(f"- **Ordem:** onda {l['onda']}, passo {l['passo']}; começa depois dos lotes "
                 + (', '.join(sorted(dep_lote[l['id']] - set(l['ciclo']))) or 'da onda anterior (nenhum desta onda)')
                 + (f"; **ciclo** com {', '.join(x for x in l['ciclo'] if x != l['id'])}: andam em paralelo, o "
                    'conferidor aceita as pendências desses lotes como aviso, e a onda fecha com `--estrito`'
                    if l['ciclo'] else ''))
        o.append(f"- **Arquivos:** {len(arqs)} ({sum(1 for a in arqs if a in tem_leg)} importam `@sgh/legado`); "
                 f"specs {len(especs)} ({sum(1 for a in especs if a.endswith('.int.spec.ts'))} de integração)")
        o.append('- **Registrar em `apps/api/src/modulos/registro.ts` ao fim deste lote:** '
                 + (', '.join(f'`{r}`' for r in registrar) or 'nenhum (a unidade continua no lote seguinte ou não é módulo)'))
        o.append('\n## Autoconferência (um comando; devolve "ok" ou a lista de erros)\n')
        o.append(f"```sh\ntools/obra/conferir-lote-f22.sh {l['id']}\n```")
        o.append('Ele confere, nos arquivos do lote e nos novos não rastreados das pastas do lote: zero `@sgh/legado`; '
                 'fecho de imports sem legado; arquivos no `tsconfig.migrado.json`; `tsc` do fecho migrado com 0 erros; '
                 'vitest dos specs do lote (unidade e integração, os novos também) verdes; e o registro do módulo, quando '
                 'pedido acima. Arquivo apagado de propósito (ex.: `porta-legado.ts`) sai da conferência sozinho.\n')
        o.append('## Arquivos (L = importa o legado)\n')
        for a in arqs:
            o.append(f"- {'L' if a in tem_leg else '·'} `{a}`")
        o.append('\n## Símbolos do legado a substituir\n')
        o.append('**a) Mesmo nome no `@sgh/nucleo` (só trocar o import; conferir a assinatura):** '
                 + (', '.join(f'`{s}`×{n}' for s, n in nuc) or 'nenhum'))
        o.append('\n**b) Renomeados ou sem equivalente:** ' + (', '.join(f'`{s}`×{n} → {d}' for s, n, d in ren) or 'nenhum'))
        o.append(f'\n**c) Persistência e tipos do legado ({len(domi)}) — viram porta própria com SQL nas tabelas-alvo '
                 'e tipos de negócio (sem `*Lido`/`*Legado`, sem S/N, HHMM ou sentinela):**\n')
        tipos = [(x, n) for x, n in domi if x[:1].isupper()]
        funcs = [(x, n) for x, n in domi if not x[:1].isupper()]
        o.append('- **Tipos:** ' + (', '.join(f'`{x}`×{n}' for x, n in tipos) or 'nenhum'))
        o.append('- **Funções e constantes:** ' + (', '.join(f'`{x}`×{n}' for x, n in funcs) or 'nenhuma'))
        o.append('\n## Portas, fontes e repositórios do lote\n')
        for a, n in portas:
            o.append(f'- `{n}` em `{a}`')
        if not portas:
            o.append('- nenhuma interface `Porta*`/`Fonte*`/`Repositorio*` exportada')
        o.append('\n## Dependências\n')
        o.append('- **Importa de outras unidades** (unidade: onda em que os arquivos importados são migrados, nº de '
                 'imports; onda maior que a deste lote = só tipo/sem legado no caminho): '
                 + (', '.join(f"{v}(onda {onda_dep[v]}, {n})" for v, n in sorted(deps_l.items())) or 'nenhuma'))
        if 'api-desmontagem' in deps_l:
            o.append('- **Atenção:** o lote importa de `apps/api/src/app.module.ts` (boot antigo, desmontado na última onda). '
                     'Mova o que é importado para um arquivo neutro do próprio módulo ou da base, sem legado.')
        o.append('- **É importada por:** ' + (', '.join(quem) or 'ninguém'))
        o.append('\n## Contratos (Zod) usados pelo lote, por arquivo\n')
        for p in sorted(contr):
            o.append(f"- `{p}`: {', '.join(sorted(contr[p])[:30])}{' …' if len(contr[p]) > 30 else ''}")
        if not contr:
            o.append('- nenhum')
        o.append(f'\n## Tabelas-alvo (casamento por nome de domínio; confirme pelo DDL)\n')
        o.append('Com DDL completo abaixo: ' + ', '.join(f'`{t}`' for t in completas))
        o.append('\nOutras candidatas (leia o DDL em `db/migracoes` só se precisar): '
                 + (', '.join(f'`{t}`' for t in nomes) or 'nenhuma'))
        o.append('\n## DDL das tabelas-alvo (copiado de `db/migracoes`)\n')
        for t in completas:
            loc, texto = criar[t]
            o.append(f'### `{t}` ({cat.get(t, ("?", "?"))[0]}, {cat.get(t, ("?", "?"))[1]}) — `{loc}`\n')
            o.append('```sql\n' + texto + ('\n' + '\n'.join(chaves[t]) if chaves.get(t) else '') + '\n```')
        with open(os.path.join(SAIDA, l['id'] + '.md'), 'w', encoding='utf-8') as h:
            h.write('\n'.join(o) + '\n')
        idx.append(f"{l['id']}\t{l['onda']}\t{l['passo']}\t{','.join(sorted(dep_lote[l['id']])) or '-'}\t{','.join(dict.fromkeys(us))}\t{len(arqs)}\t"
                   f"{sum(1 for a in arqs if a in tem_leg)}\t{len(sims)}\t{len(completas)}\t{','.join(registrar) or '-'}")
    with open(os.path.join(SAIDA, 'indice.tsv'), 'w', encoding='utf-8') as h:
        h.write('\n'.join(idx) + '\n')
    print(f'gravados: {len(lotes)} fatias + listas, unidades.tsv, indice.tsv em docs/obra/fatias/f22/')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
