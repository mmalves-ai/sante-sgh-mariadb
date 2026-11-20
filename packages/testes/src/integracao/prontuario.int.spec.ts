// Prontuário ao vivo sobre a cópia (ficha do M15, seção 10). Leituras: os BLOB materializados antes do fim da
// transação (o texto decodificado vale depois dela); consulta cancelada pelo driver ao passar do tempo; 0 leitura
// sequencial nas maiores tabelas no caminho da tela; tempos da lista e do registro (indicação, sem dado). Ao
// vivo: um registro SINTÉTICO inserido "por fora" (como o SPDATA gravaria) aparece na lista e abre, com o texto
// CP1252 e o formulário UTF-8 acentuados sem caractere de substituição; tudo desfeito (ROLLBACK). Trilha: só de
// inclusão (o papel da aplicação só tem SELECT e INSERT na SGH_TRILHA e na SGH_PEP_FORM_VERSAO); 3 aberturas = 3
// eventos, sem texto clínico nem nome. Dois hospitais: Bloqueio HS-1 (só o pc tem cópia). Saída só com contagens.
import {
  amostraDeRegistros,
  codificarCp1252,
  conferirNomeObjeto,
  excecoesDoProntuario,
  type Leitor,
  lerMetadadosTabela,
  ErroTempoEsgotado,
  fontesDosRegistros,
  gravarTrilha,
  lerConteudoRegistro,
  lerRegistroDoPaciente,
  lerRespostasRegistro,
  listarRegistrosPaciente,
  textosDoPaciente,
} from '@sgh/legado';
import { chaveLeitura } from '@sgh/contratos';
import { lerLayoutEpoca, rtfParaTexto, textoCorrido } from '@sgh/dominio-pep';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravarRegistroPorFora } from '../massa/prontuario.js';
import { MARCA_SINTETICA } from '../massa/sintetica.js';
import { type Ambiente, codigos, ctx, num, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const CORPUS = 'AÇÃO coração pressão Éder Conceição Ângela açúcar óbito pós-operatório índice';

/**
 * Estado que o ROLLBACK tem de devolver igual (lente "contagens iguais após ROLLBACK"): contagem e maior ID do
 * cabeçalho e do conteúdo, contagem de cada tabela em que os gatilhos deles escrevem e o valor atual de cada
 * generator de que esses gatilhos dependem (GEN_ID dentro de gatilho não volta no ROLLBACK). Só números.
 */
async function estadoDoRegistroPorFora(l: Leitor): Promise<Record<string, number>> {
  const principais = ['PRCABEVOL', 'PRCONTEVOL'] as const;
  const metas = await Promise.all(principais.map((t) => lerMetadadosTabela(l, t)));
  const tabelas = new Set<string>(principais);
  const generators = new Set<string>();
  for (const m of metas) {
    for (const g of m.generators) generators.add(g);
    for (const t of m.triggers) {
      if (t.inativo) continue;
      for (const g of Object.values(t.analise.generators)) generators.add(g);
      for (const w of t.analise.escreveEm) tabelas.add(w.tabela);
    }
  }
  const estado: Record<string, number> = {};
  for (const t of [...tabelas].sort()) {
    const [r] = await l.consultar(`SELECT COUNT(*) N FROM ${conferirNomeObjeto(t)}`, [], {
      teto: 1,
      tempoMaximoMs: 60_000,
    });
    estado[`linhas:${t}`] = num(r?.['N']);
  }
  const [mx] = await l.consultar(
    'SELECT (SELECT MAX(ID_CABEVOL) FROM PRCABEVOL) C, (SELECT MAX(ID) FROM PRCONTEVOL) T FROM RDB$DATABASE',
    [],
    { teto: 1 },
  );
  estado['maior:PRCABEVOL'] = num(mx?.['C']);
  estado['maior:PRCONTEVOL'] = num(mx?.['T']);
  for (const g of [...generators].sort()) {
    const [r] = await l.consultar(`SELECT GEN_ID(${conferirNomeObjeto(g)}, 0) V FROM RDB$DATABASE`, [], {
      teto: 1,
    });
    estado[`generator:${g}`] = num(r?.['V']);
  }
  return estado;
}

describe.skipIf(!PODE_ESCREVER)('prontuário ao vivo na cópia', () => {
  let a: Ambiente;
  let alvo: { registro: number; paciente: number };
  beforeAll(async () => {
    a = await prepararAmbiente();
    const s = await a.nucleo.lerSomente(ctx(a), (l) => amostraDeRegistros(l));
    const x = s.comDocumento ?? s.semDocumento;
    if (!x) throw new Error('Cópia sem registro de amostra.');
    alvo = x;
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('BLOB materializado na transação: o texto decodificado vale depois do fim dela', async () => {
    const c = await a.nucleo.lerSomente(ctx(a), (l) =>
      lerConteudoRegistro(l, alvo.registro, { rtf: true, xml: true }),
    );
    // Fora da transação (a conexão já voltou ao pool): o conteúdo continua legível e inteiro.
    expect(c?.rtf ?? '').toMatch(/^\s*\{\\rtf/);
    const t = rtfParaTexto(c!.rtf!);
    expect(textoCorrido(t).length).toBeGreaterThan(0);
    if (c?.xml) expect(lerLayoutEpoca(c.xml).campos.length).toBeGreaterThan(0);
    console.log(
      `[${a.cod}] conteúdo: ${c?.bytes ?? 0} bytes; parágrafos ${t.paragrafos.length}; ignorados ${Object.keys(t.ignorados).length}`,
    );
  });

  it('consulta cancelada pelo driver ao passar do tempo (e a conexão segue boa)', async () => {
    await expect(
      a.nucleo.lerSomente(ctx(a), (l) =>
        l.consultar(
          'SELECT COUNT(*) N FROM PREVOLPAC p JOIN PRCABEVOL c ON c.ID_CABEVOL = p.ID_CABEVOL',
          [],
          {
            teto: 1,
            tempoMaximoMs: 50,
          },
        ),
      ),
    ).rejects.toBeInstanceOf(ErroTempoEsgotado);
    const [x] = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar('SELECT 1 N FROM RDB$DATABASE', [], { teto: 1 }),
    );
    expect(num(x?.['N'])).toBe(1);
  });

  it('caminho da tela sem leitura sequencial nas maiores tabelas; tempos (indicação)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const t: Record<string, number> = {};
      const medir = async <T>(n: string, f: () => Promise<T>) => {
        const i = performance.now();
        const v = await f();
        t[n] = Math.round(performance.now() - i);
        return v;
      };
      const p = await medir('lista', () => listarRegistrosPaciente(l, alvo.paciente, {}, 1));
      await medir('fontes', () => fontesDosRegistros(l, p.registros));
      await medir('registro', () => lerRegistroDoPaciente(l, alvo.paciente, alvo.registro));
      await medir('conteudo', () => lerConteudoRegistro(l, alvo.registro, { rtf: true, xml: true }));
      await medir('respostas', () => lerRespostasRegistro(l, alvo.registro));
      await medir('busca', () => textosDoPaciente(l, alvo.paciente, {}, 50));
      const linhas = await l.consultar(
        `SELECT TRIM(TS.MON$TABLE_NAME) T, RS.MON$RECORD_SEQ_READS S
           FROM MON$TRANSACTIONS TR
           JOIN MON$TABLE_STATS TS ON TS.MON$STAT_ID = TR.MON$STAT_ID AND TS.MON$STAT_GROUP = 2
           JOIN MON$RECORD_STATS RS ON RS.MON$STAT_ID = TS.MON$RECORD_STAT_ID
          WHERE TR.MON$TRANSACTION_ID = CURRENT_TRANSACTION
            AND TS.MON$TABLE_NAME IN ('PRCABEVOL', 'PRCONTEVOL', 'PREVOLPAC', 'HTPACIENTE', 'PRASSINATURA_CAB', 'PRASSINATURA_DOC')`,
        [],
        { teto: 10 },
      );
      return {
        t,
        seq: Object.fromEntries(linhas.map((x) => [String(x['T']), num(x['S'])])),
        n: p.registros.length,
      };
    });
    for (const [tabela, s] of Object.entries(r.seq)) expect(s, tabela).toBe(0);
    console.log(
      `[${a.cod}] prontuário: ${r.n} registro(s) na página; tempos (ms) ${JSON.stringify(r.t)}; sequenciais ${JSON.stringify(r.seq)}`,
    );
  });

  it('ao vivo: o registro gravado "por fora" aparece na lista e abre; acentos sem substituição; desfeito', async () => {
    const antes = await a.nucleo.lerSomente(ctx(a), (l) => estadoDoRegistroPorFora(l));
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const rtf = `{\\rtf1\\ansi\\ansicpg1252 ${MARCA_SINTETICA} ${[...CORPUS]
        .map((ch) => (ch.charCodeAt(0) < 0x80 ? ch : `\\'${codificarCp1252(ch)[0]!.toString(16)}`))
        .join('')}\\par}`;
      const xml = `<evolucao id_evolucao="1"><componente><className>TfRespTexto</className><name>cmp1</name><top>0</top><left>0</left><height>1</height><width>744</width><title>Teste ${MARCA_SINTETICA}</title><value>${CORPUS}</value></componente></evolucao>`;
      const { id } = await gravarRegistroPorFora(
        e,
        alvo.registro,
        Buffer.from(rtf, 'latin1'),
        Buffer.from(xml, 'utf8'),
      );
      // A leitura da tela, na mesma transação (o SPDATA confirmaria; aqui nada é confirmado): aparece já.
      const p = await listarRegistrosPaciente(e, alvo.paciente, {}, 1);
      const c = await lerConteudoRegistro(e, id, { rtf: true, xml: true });
      return {
        primeiro: p.registros[0]?.id === id,
        texto: textoCorrido(rtfParaTexto(c?.rtf ?? '')),
        campo: lerLayoutEpoca(c?.xml ?? '<evolucao/>').campos[0],
        id,
      };
    });
    expect(r.primeiro).toBe(true);
    expect(r.texto).toContain(CORPUS);
    expect(r.texto).not.toMatch(/�/);
    expect(r.campo).toMatchObject({ valor: { tipo: 'texto', texto: CORPUS } });
    // Depois do ROLLBACK: o registro sintético não existe.
    const depois = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar('SELECT COUNT(*) N FROM PRCABEVOL WHERE ID_CABEVOL = ?', [r.id], { teto: 1 }),
    );
    expect(num(depois[0]?.['N'])).toBe(0);
    // Contagens, maiores IDs e generators iguais aos de antes: nada ficou, nenhum generator avançou.
    const apos = await a.nucleo.lerSomente(ctx(a), (l) => estadoDoRegistroPorFora(l));
    expect(apos).toEqual(antes);
    console.log(
      `[${a.cod}] por fora desfeito: ${Object.keys(antes).filter((k) => k.startsWith('linhas:')).length} tabela(s) e ${Object.keys(antes).filter((k) => k.startsWith('generator:')).length} generator(s) iguais depois do ROLLBACK`,
    );
  });

  it('exceções do estabelecimento (regra 9): só contagens por modelo e mês, no tempo de tela', async () => {
    const t0 = performance.now();
    const linhas = await a.nucleo.lerSomente(ctx(a), (l) => excecoesDoProntuario(l));
    const ms = Math.round(performance.now() - t0);
    const total = (tipo: string) =>
      linhas.filter((x) => x.tipo === tipo).reduce((s, x) => s + x.registros, 0);
    for (const x of linhas) {
      expect(Object.keys(x).sort()).toEqual(['codigo', 'mes', 'modelo', 'nome', 'registros', 'tipo']);
      expect(x.registros).toBeGreaterThan(0);
    }
    // A mesma conta pelo caminho simples (sem agrupar).
    const [c] = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar(
        `SELECT COUNT(*) N FROM PRCABEVOL c WHERE NOT EXISTS (SELECT 1 FROM PRCONTEVOL x WHERE x.ID_PRCABEVOL = c.ID_CABEVOL)`,
        [],
        { teto: 1, tempoMaximoMs: 60_000 },
      ),
    );
    expect(total('sem-conteudo')).toBe(num(c?.['N']));
    const mostrar = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
    console.log(
      `[${a.cod}] exceções: ${linhas.length} estrato(s); sem conteúdo ${mostrar(total('sem-conteudo'))}, data impossível ${mostrar(total('data-impossivel'))}; ${ms} ms`,
    );
  });

  it('trilha só de inclusão: o papel da aplicação tem só SELECT e INSERT', async () => {
    const linhas = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar(
        `SELECT TRIM(RDB$RELATION_NAME) T, RDB$PRIVILEGE P FROM RDB$USER_PRIVILEGES
          WHERE RDB$USER = 'SGH_APLICACAO' AND RDB$RELATION_NAME IN ('SGH_TRILHA', 'SGH_PEP_FORM_VERSAO')`,
        [],
        { teto: 50 },
      ),
    );
    const por = new Map<string, string[]>();
    for (const x of linhas)
      por.set(String(x['T']), [...(por.get(String(x['T'])) ?? []), String(x['P']).trim()].sort());
    expect(por.get('SGH_TRILHA')).toEqual(['I', 'S']);
    expect(por.get('SGH_PEP_FORM_VERSAO')).toEqual(['I', 'S']);
  });

  it('leitura auditada: 3 aberturas = 3 eventos, só parte e motivo (desfeito)', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const ids: string[] = [];
      for (const parte of ['registro', 'texto', 'respostas'] as const) {
        const t = await gravarTrilha(e, {
          rede: a.nucleo.rede,
          hospital: a.cod,
          usuario: 'SGH.INTEGRACAO',
          evento: 'pep.registro.lido',
          recurso: 'pep.prontuario',
          operacao: 'auditoria.registrarEvento',
          tabelaAlvo: 'PRCABEVOL',
          idAlvo: String(alvo.registro),
          chaveNaturalAlvo: chaveLeitura(parte, 'same'),
          resultado: 'sucesso',
          estacao: 'SGH-INTEGRACAO:m15',
          correlacao: `int-m15-${parte}`,
          idPaciente: alvo.paciente,
        });
        ids.push(t.id);
      }
      return e.consultar(
        `SELECT CHAVE_NATURAL_ALVO C, ID_RICADPAC P FROM SGH_TRILHA WHERE ID IN (${ids.map(() => 'CAST(? AS BIGINT)').join(', ')})`,
        ids,
        { teto: 10 },
      );
    });
    expect(r).toHaveLength(3);
    for (const x of r) {
      expect(String(x['C'])).toMatch(/^parte:(registro|texto|respostas);motivo:same$/);
      expect(num(x['P'])).toBe(alvo.paciente);
    }
  });

  it.skipIf(codigos.length > 1)('dois hospitais: Bloqueio HS-1 (só o pc tem cópia)', () => {
    expect(codigos).toEqual(['pc']);
  });
});
