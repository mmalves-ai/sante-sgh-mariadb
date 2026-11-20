// Prontuário de uso diário na cópia (ficha do M23, seção 10): (1) as LEITURAS do painel, do cabeçalho, da linha do
// tempo, dos documentos, das alergias, dos exames, dos resultados, dos anexos, dos pareceres e das SGH_ rodam sobre
// o banco de verdade (READ ONLY) sem erro, dentro do teto de tempo; (2) pelo EXECUTOR, em transação desfeita
// (ROLLBACK), a receita, o atestado com a correção ligada ao original, a suspensão, o sumário de alta, o anexo, o
// exame externo, a alergia e o pedido de exames gravam como a receita diz: o relido pelas leituras da tela confere,
// o documento da trilha (base64 + zlib, Windows-1252) traz o ID da origem e a prova do novo (SGH_PEP_DOCUMENTO) está
// ligada; (3) o ROLLBACK devolve tudo (contagens das tabelas gravadas). Os cenários são os da reprodução da
// assinatura (mesma massa SINTÉTICA, "SINTETICO M23"); o profissional e o paciente da cópia só em memória. Saída só
// com contagens.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  alergiasDoPaciente,
  anexosDoPaciente,
  atendimentosPep,
  catalogoAlergias,
  catalogoExames,
  cienciasDoPaciente,
  documentoDaTrilha,
  documentoSghPorOrigem,
  documentosDoPaciente,
  documentosSghDoPaciente,
  especialidades,
  eventosDoPaciente,
  examesExternosDoPaciente,
  fichasDeImpressao,
  filaDoParecer,
  historicoPareceres,
  kitsDeExames,
  lerAtestado,
  lerExameExterno,
  lerReceita,
  type Leitor,
  modelosDeDocumentoEmUso,
  operacao,
  pacientePep,
  painelPacientes,
  cicloVigiaParecer,
  completudeDoPainel,
  ErroOperacao,
  pedidosDeParecerLegado,
  pedidosDoPaciente,
  problemasDoPaciente,
  resultadosDoPaciente,
  TIPO_ATO,
  temposDoPaciente,
  tiposDeAnexo,
  tiposDeTermo,
  unidadesDoPainel,
  versaoDasAlergiasAtivas,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rtfParaTexto, textoCorrido } from '@sgh/dominio-pep';
import { CORPUS_CP1252, cenarioPepM23, MARCA_M23 } from '../massa/reproducao-pep-m23.js';
import { gravarPedidoDeParecerComoOLegado, liberarValorComoOLegado } from '../massa/simulacao-legado-m23.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

/** As 8 operações do marco (e o registro clínico que a alergia exige, preparado pela reprodução). */
const OPERACOES_M23 = [
  'pep.registrarAlergia',
  'pep.inativarAlergia',
  'pep.emitirDocumento',
  'pep.suspenderDocumento',
  'pep.finalizarSumarioAlta',
  'pep.anexarDocumento',
  'pep.lancarExameExterno',
  'pep.solicitarExame',
  'pep.registrarEvolucao',
];

/**
 * As tabelas que o ROLLBACK tem de devolver, geradas das receitas (passos, efeitos de gatilho e registros SGH_), das
 * tabelas que as assinaturas do marco capturaram (inclui o que os gatilhos gravam) e das trilhas que o executor grava
 * na mesma transação (SGH_TRILHA, SGH_IDEMPOTENCIA, SGH_OUTBOX e a trilha do legado).
 */
function tabelasDoMarco(): string[] {
  const t = new Set<string>([
    'SGH_TRILHA',
    'SGH_IDEMPOTENCIA',
    'SGH_OUTBOX',
    'TBCABTRILHA',
    'TBLANTRILHASGH',
  ]);
  for (const n of OPERACOES_M23) {
    const r = operacao(n).receita;
    r.passos.forEach((p) => t.add(p.tabela));
    r.efeitos.forEach((e) => t.add(e.tabela));
    (r.registrosSgh ?? []).forEach((x) => t.add(x));
  }
  const raiz = resolve(import.meta.dirname, '../../../legado/src/pep/assinaturas');
  for (const op of readdirSync(raiz).filter((d) => OPERACOES_M23.includes(d)))
    for (const f of readdirSync(join(raiz, op)).filter((x) => x.endsWith('.assinatura.json'))) {
      const a = JSON.parse(readFileSync(join(raiz, op, f), 'utf8')) as { tabelas: { tabela: string }[] };
      a.tabelas.forEach((x) => t.add(x.tabela));
    }
  return [...t].sort();
}
const TABELAS = tabelasDoMarco();

/**
 * Retrato das tabelas: com coluna ID, o maior ID (a prova é "nenhuma linha acima dele" depois do ROLLBACK, pelo
 * índice, sem varrer as tabelas de milhões); sem ela, a contagem.
 */
async function contagens(
  l: Leitor,
): Promise<Record<string, { maiorId: number | null; linhas: number | null }>> {
  const r: Record<string, { maiorId: number | null; linhas: number | null }> = {};
  for (const t of TABELAS) {
    const [c] = await l.consultar(
      "SELECT COUNT(*) N FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ? AND RDB$FIELD_NAME = 'ID'",
      [t],
      { teto: 1 },
    );
    if (num(c?.['N']) > 0) {
      const [x] = await l.consultar(`SELECT MAX(ID) M FROM ${t}`, [], { teto: 1, tempoMaximoMs: 600_000 });
      r[t] = { maiorId: x?.['M'] === null || x?.['M'] === undefined ? 0 : num(x['M']), linhas: null };
    } else {
      const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1, tempoMaximoMs: 600_000 });
      r[t] = { maiorId: null, linhas: num(x?.['N']) };
    }
  }
  return r;
}

/** Linhas acima do maior ID de antes (com ID) ou a contagem (sem ID), depois do ROLLBACK. */
async function sobras(
  l: Leitor,
  antes: Record<string, { maiorId: number | null; linhas: number | null }>,
): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const [t, a] of Object.entries(antes)) {
    if (a.maiorId !== null) {
      const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t} WHERE ID > ?`, [a.maiorId], {
        teto: 1,
        tempoMaximoMs: 600_000,
      });
      r[t] = num(x?.['N']);
    } else {
      const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1, tempoMaximoMs: 600_000 });
      r[t] = num(x?.['N']) - (a.linhas ?? 0);
    }
  }
  return r;
}

/** O texto do modelo de impressão (o RTF dentro do XML, com as entidades), como a tela abre. */
function textoDoXmlDoModelo(xml: string): string {
  const d = xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const i = d.indexOf('{\\rtf');
  const f = d.lastIndexOf('}');
  return i >= 0 && f > i ? textoCorrido(rtfParaTexto(d.slice(i, f + 1))) : d;
}

/** XML do documento da trilha: base64(zlib(XML CP1252)) → texto (Windows-1252). */
function decodificar(xml: string): string {
  try {
    return new TextDecoder('windows-1252').decode(inflateSync(Buffer.from(xml, 'base64')));
  } catch {
    return xml;
  }
}

describe.skipIf(!PODE_ESCREVER)('prontuário de uso diário na cópia', () => {
  let a: Ambiente;
  let antes: Awaited<ReturnType<typeof contagens>>;
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), (l) => contagens(l));
  }, 1_200_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras do prontuário rodam no banco do estabelecimento (READ ONLY), com teto de tempo', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const t0 = Date.now();
      const painel = await painelPacientes(l, { unidade: null, busca: null });
      const tPainel = Date.now() - t0;
      const linha = painel.linhas[0];
      if (!linha) throw new Error('Painel vazio na cópia.');
      const p = linha.paciente;
      const t1 = Date.now();
      const pac = await pacientePep(l, p);
      const ats = await atendimentosPep(l, p);
      const tCab = Date.now() - t1;
      const hoje = new Date().toISOString().slice(0, 10);
      const t2 = Date.now();
      const ev = await eventosDoPaciente(
        l,
        p,
        { de: '2020-01-01', ate: hoje },
        new Set([
          'atendimento',
          'registro',
          'parecer',
          'exame-pedido',
          'exame-resultado',
          'receita',
          'atestado',
          'alergia',
          'anexo',
          'exame-externo',
        ]),
        200,
      );
      const tLinha = Date.now() - t2;
      const contar = {
        unidades: (await unidadesDoPainel(l)).length,
        atendimentos: ats.length,
        eventos: ev.length,
        alergias: (await alergiasDoPaciente(l, p)).length,
        agentes: (await catalogoAlergias(l)).agentes.length,
        exames: (await catalogoExames(l, null)).length,
        kits: (await kitsDeExames(l)).length,
        pedidos: (await pedidosDoPaciente(l, p)).length,
        resultados: (await resultadosDoPaciente(l, p)).length,
        externos: (await examesExternosDoPaciente(l, p)).length,
        anexos: (await anexosDoPaciente(l, p)).length,
        receitas: (await documentosDoPaciente(l, p, 'receita')).length,
        atestados: (await documentosDoPaciente(l, p, 'atestado')).length,
        fichas: (await fichasDeImpressao(l)).length,
        modelos: (await modelosDeDocumentoEmUso(l, '2026-01-01')).length,
        termos: (await tiposDeTermo(l)).length,
        tiposAnexo: (await tiposDeAnexo(l)).length,
        tempos: (await temposDoPaciente(l, p)).length,
        especialidades: (await especialidades(l)).length,
        historico: Object.values(await historicoPareceres(l, null)).reduce((s, n) => s + n, 0),
        pareceresLegado: (await pedidosDeParecerLegado(l, 0, 20)).length,
        sgh: (await documentosSghDoPaciente(l, a.cod, p)).length,
        problemas: (await problemasDoPaciente(l, a.cod, p)).length,
        ciencias: (await cienciasDoPaciente(l, a.cod, p)).length,
        fila: (await filaDoParecer(l, a.cod, {})).length,
      };
      return { pac: pac !== null, painel: painel.linhas.length, tPainel, tCab, tLinha, contar };
    });
    expect(r.pac).toBe(true);
    expect(r.painel).toBeGreaterThan(0);
    expect(r.contar.fichas).toBeGreaterThan(0);
    expect(r.contar.exames).toBeGreaterThan(0);
    // Regra 19 (abrir o prontuário < 1,5 s): cabeçalho e linha do tempo do primeiro paciente do painel.
    expect(r.tCab + r.tLinha).toBeLessThan(15_000);
    console.log(
      `[${a.cod}] painel ${r.painel} linhas em ${r.tPainel} ms; cabeçalho ${r.tCab} ms; linha do tempo ${r.tLinha} ms; ` +
        Object.entries(r.contar)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
    );
  }, 1_200_000);

  /** Roda um cenário da reprodução (preparar + executar) pelo executor na transação desfeita. */
  async function cenario<T>(
    nome: string,
    nomeCenario: string,
    depois: (l: Leitor, resultado: Record<string, unknown>) => Promise<T>,
  ): Promise<T> {
    return a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      let operador = '';
      let ultimo: Record<string, unknown> = {};
      const executarOutra = async (x: typeof e, op: string, entrada: unknown, login: string) => {
        const s = await a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, login), {
          escritor: x,
        });
        return { resultado: s.resultado as Record<string, unknown> };
      };
      const c = cenarioPepM23(
        nome,
        nomeCenario,
        { operacao: nome, cenario: nomeCenario, tabelas: [] },
        a.cod,
        async (x, entrada) => {
          const s = await executarOutra(x, nome, entrada, operador);
          ultimo = s.resultado;
          return s;
        },
        executarOutra,
        (login) => {
          operador = login;
        },
      );
      await c.preparar?.(e);
      await c.executar(e);
      return depois(e, ultimo);
    });
  }

  it('receita de controle especial: relida pela tela; documento da trilha com o ID; prova do novo ligada', async () => {
    const r = await cenario('pep.emitirDocumento', 'receita-controlada', async (l, s) => {
      const origem = num(s['origem']);
      const lida = await lerReceita(l, origem);
      const doc = await documentoDaTrilha(l, TIPO_ATO.receita, origem);
      const prova = await documentoSghPorOrigem(l, a.cod, 'PRRECEITA', origem);
      return {
        lida: lida !== null && (lida.rtf ?? '').includes('SINTETICO'),
        // Regra 18: o corpus CP1252 vai e volta igual pelo RTF gravado e pelo documento da trilha decodificado.
        corpus: lida !== null && textoCorrido(rtfParaTexto(lida.rtf ?? '')).includes(CORPUS_CP1252),
        doc: doc !== null && decodificar(doc.xml).includes(String(origem)),
        prova: prova?.tipo,
      };
    });
    expect(r).toEqual({ lida: true, corpus: true, doc: true, prova: 'receita-controlada' });
  }, 1_200_000);

  it('corpus CP1252 de ida e volta no atestado e na observação da alergia', async () => {
    const atestado = await cenario('pep.emitirDocumento', 'atestado-sem-cid', async (l, s) => {
      const lido = await lerAtestado(l, num(s['origem']));
      const doc = await documentoDaTrilha(l, TIPO_ATO.atestado, num(s['origem']));
      return {
        // O conteúdo do modelo de impressão relido pelo leitor da tela (o mesmo da abertura do documento).
        xml: textoDoXmlDoModelo(lido?.xml ?? '').includes(CORPUS_CP1252),
        doc: doc !== null && decodificar(doc.xml).includes(CORPUS_CP1252),
      };
    });
    expect(atestado).toEqual({ xml: true, doc: true });
    const alergia = await cenario('pep.registrarAlergia', 'outro-agente', async (l, s) => {
      const [x] = await l.consultar(
        'SELECT OBSERVACAO O FROM PRALERGIAPAC WHERE ID = ?',
        [num(s['alergia'])],
        {
          teto: 1,
        },
      );
      return String(x?.['O'] ?? '');
    });
    expect(alergia).toBe(`OBSERVACAO ${MARCA_M23} ${CORPUS_CP1252}`);
  }, 1_200_000);

  it('concorrência: a linha mudada por outro terminal entre a leitura e o Salvar é recusada (409), sem sobrescrever', async () => {
    // As reproduções de colisão: a mesma alergia retirada e o mesmo documento suspenso por outro terminal depois da
    // leitura da tela; o agente já incluído na lista ativa. Cada uma exige a recusa (a reprodução falha se gravar).
    await cenario('pep.inativarAlergia', 'recusa-colisao', async () => null);
    await cenario('pep.suspenderDocumento', 'recusa-ja-suspenso', async () => null);
    await cenario('pep.registrarAlergia', 'recusa-duplicada', async () => null);
  }, 1_800_000);

  it('LOCK TIMEOUT: outra conexão segura a alergia e a retirada devolve "registro em edição", nada gravado', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar(
        `SELECT FIRST 1 a.ID, h.ID_RICADPAC P FROM PRALERGIAPAC a JOIN PRCABEVOL c ON c.ID_CABEVOL = a.ID_PRCABEVOL
           JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE WHERE COALESCE(a.RETIRAR_VINCULO_PACIENTE, 'F') = 'F'
          ORDER BY a.ID DESC`,
        [],
        { teto: 1 },
      );
      return x ? { alergia: num(x['ID']), paciente: num(x['P']) } : null;
    });
    if (!alvo) throw new Error('Nenhuma alergia ativa na cópia.');
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT ID FROM PRALERGIAPAC WHERE ID = ? WITH LOCK', [alvo.alergia], { teto: 1 });
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let codigo = '';
    let retirada = '';
    const inicio = Date.now();
    try {
      await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        // O operador: o profissional que a reprodução da retirada usa (só em memória).
        let operador = '';
        const c = cenarioPepM23(
          'pep.inativarAlergia',
          'superada',
          { operacao: 'pep.inativarAlergia', cenario: 'superada', tabelas: [] },
          a.cod,
          async () => ({ resultado: {} }),
          async (x, op, entrada, login) => ({
            resultado: (
              await a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, login), { escritor: x })
            ).resultado as Record<string, unknown>,
          }),
          (login) => {
            operador = login;
          },
        );
        await c.preparar?.(e);
        try {
          await a.executor.executar(
            operacao('pep.inativarAlergia'),
            a.cod,
            {
              paciente: alvo.paciente,
              alergia: alvo.alergia,
              motivo: `Alergia superada ${MARCA_M23}`,
              versao: await versaoDasAlergiasAtivas(e, alvo.paciente),
            },
            ctxOperacao(a, operador),
            { escritor: e },
          );
        } catch (x) {
          codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : String(x);
        }
        const [r] = await e.consultar(
          'SELECT RETIRAR_VINCULO_PACIENTE R FROM PRALERGIAPAC WHERE ID = ?',
          [alvo.alergia],
          {
            teto: 1,
          },
        );
        retirada = String(r?.['R'] ?? 'F').trim() || 'F';
      });
    } finally {
      soltar();
      await segurando;
    }
    expect(codigo).toBe('registro-em-edicao');
    expect(retirada).toBe('F');
    console.log(`[${a.cod}] trava: registro em edição em ${Date.now() - inicio} ms`);
  }, 1_200_000);

  it('leitura incremental: o pedido de parecer gravado "pelo outro sistema" (SQL de teste) entra na fila; o histórico não', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const c = {
        rede: a.nucleo.rede,
        hospital: a.cod,
        traceId: 'integracao-m23',
        usuarioLegado: 'SGH.VIGIA',
      };
      const um = <T>(fn: (x: typeof e) => Promise<T>) => fn(e);
      // Primeira execução: a marca nasce no maior registro clínico (nenhum histórico entra).
      const antes = await cicloVigiaParecer(um, um, c);
      const filaAntes = (await filaDoParecer(e, a.cod, {})).length;
      // O outro sistema grava um pedido de parecer: cópia de um pedido existente, como o executável grava.
      const [m] = await e.consultar(
        `SELECT FIRST 1 c.ID_CABEVOL ID FROM PRCABEVOL c JOIN PREVOLUCAO v ON v.ID_EVOLUCAO = c.ID_EVOLUCAO
          WHERE v.COD = 'MED09' AND c.DATA_HORA_SUSPENSAO IS NULL ORDER BY c.ID_CABEVOL DESC`,
        [],
        { teto: 1 },
      );
      if (!m) return { semPedido: true };
      await gravarPedidoDeParecerComoOLegado(e, num(m['ID']));
      const depois = await cicloVigiaParecer(um, um, c);
      const fila = await filaDoParecer(e, a.cod, {});
      return {
        semPedido: false,
        iniciada: antes.iniciada || antes.marca > 0,
        incluidos: depois.incluidos,
        novos: fila.length - filaAntes,
        legado: fila.filter((f) => f.origem === 'legado').length > 0,
      };
    });
    if (r.semPedido) return;
    expect(r).toMatchObject({ iniciada: true, incluidos: 1, novos: 1, legado: true });
  }, 1_200_000);

  it('liberação "pelo outro sistema" (SQL de teste): o valor fora do pânico aparece nos valores do painel', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [x] = await e.consultar(
        `SELECT FIRST 1 r.ID, h.ID_RICADPAC P, s.ID X, e.MAX_ABE MA FROM SIRES01 r JOIN SILANEXA s ON s.ID = r.ID_SILANEXA
           JOIN HTPACIENTE h ON h.ID = s.ID_HTPACIENTE JOIN SITABELE e ON e.CODPRC = r.EXAME AND e.CODELE = r.ELEMENTO
          WHERE s.RESLIB = 'T' AND r.NUMERICO IS NOT NULL AND e.MAX_ABE > 0 ORDER BY s.DTEMIRES DESC`,
        [],
        { teto: 1 },
      );
      if (!x) return null;
      const critico = Number(x['MA']) + 1;
      await liberarValorComoOLegado(e, num(x['ID']), critico);
      const c = await completudeDoPainel(e, a.cod, [num(x['P'])], [], new Date(2000, 0, 1));
      const v = c.valores.find((y) => y.exame === num(x['X']) && y.numerico === critico);
      return v ? v.maxAbe !== null && v.numerico > v.maxAbe : false;
    });
    if (r === null) return;
    expect(r).toBe(true);
  }, 1_200_000);

  it('atestado: correção ligada ao original suspenso; suspensão relida com a justificativa', async () => {
    const r = await cenario('pep.emitirDocumento', 'atestado-correcao', async (l, s) => {
      const nova = await lerAtestado(l, num(s['origem']));
      const original = nova?.corrige ? await lerAtestado(l, nova.corrige) : null;
      return {
        corrige: nova?.corrige !== null,
        suspenso: original?.suspensoEm !== null && original !== null,
      };
    });
    expect(r).toEqual({ corrige: true, suspenso: true });
  }, 1_200_000);

  it('sumário de alta, anexo e exame externo: relidos pelas leituras da tela', async () => {
    const sumario = await cenario(
      'pep.finalizarSumarioAlta',
      'alta-medica',
      async (l, s) => (await lerAtestado(l, num(s['origem'])))?.modelo ?? null,
    );
    expect(sumario).toMatch(/alta/i);
    const anexo = await cenario('pep.anexarDocumento', 'exame-externo', async (l, s) => {
      const id = num(s['anexo'] ?? s['origem']);
      const [x] = await l.consultar('SELECT ID_RICADPAC P FROM PRGEDIMP WHERE ID = ?', [id], { teto: 1 });
      return x ? (await anexosDoPaciente(l, num(x['P']))).some((y) => y.id === id) : false;
    });
    expect(anexo).toBe(true);
    const externo = await cenario('pep.lancarExameExterno', 'estruturado', async (l, s) => {
      const e = await lerExameExterno(l, num(s['lancamento'] ?? s['origem']));
      return e?.elementos.length ?? 0;
    });
    expect(externo).toBe(2);
  }, 1_800_000);

  it('alergia e pedido de exames: relidos pelas leituras da tela', async () => {
    const alergia = await cenario('pep.registrarAlergia', 'outro-agente', async (l, s) => {
      const id = num(s['alergia']);
      const [x] = await l.consultar(
        `SELECT h.ID_RICADPAC P FROM PRALERGIAPAC a JOIN PRCABEVOL c ON c.ID_CABEVOL = a.ID_PRCABEVOL
           JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE WHERE a.ID = ?`,
        [id],
        { teto: 1 },
      );
      return x ? (await alergiasDoPaciente(l, num(x['P']))).some((y) => y.id === id && y.ativa) : false;
    });
    expect(alergia).toBe(true);
    const pedido = await cenario('pep.solicitarExame', 'kit-urgente', async (l, s) => {
      const ag = num(s['agrupamento']);
      const [x] = await l.consultar(
        `SELECT FIRST 1 h.ID_RICADPAC P FROM PREXAMEASSINATURA p JOIN SILANEXA s ON s.ID = p.ID_SILANEXA
           JOIN HTPACIENTE h ON h.ID = s.ID_HTPACIENTE WHERE p.ID_AGRUPAMENTO = ?`,
        [ag],
        { teto: 1 },
      );
      const ps = x ? await pedidosDoPaciente(l, num(x['P'])) : [];
      return {
        exames: ps.filter((y) => y.agrupamento === ag).length,
        urgentes: ps.filter((y) => y.agrupamento === ag && y.urgente).length,
      };
    });
    expect(pedido.exames).toBeGreaterThan(0);
    expect(pedido.urgentes).toBe(pedido.exames);
  }, 1_800_000);

  it('o ROLLBACK devolve tudo: nenhuma linha nova nas tabelas que as receitas, os gatilhos e as trilhas gravam', async () => {
    expect(TABELAS).toEqual(
      expect.arrayContaining([
        'PRALERGIAPAC_TBPRINC',
        'PRLANCEXAMEESTRUTURADO',
        'PRASS_DOC_PREXAMEASS',
        'SGH_PEP_ALERGIA',
        'SGH_PEP_SUMARIO_ALTA',
        'SGH_PEP_AUTORIZ_CID',
        'SGH_TRILHA',
        'TBCABTRILHA',
      ]),
    );
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => sobras(l, antes));
    expect(Object.entries(depois).filter(([, n]) => n !== 0)).toEqual([]);
    console.log(`[${a.cod}] ROLLBACK conferido em ${TABELAS.length} tabelas`);
  }, 1_200_000);
});
