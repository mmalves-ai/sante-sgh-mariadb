// Integração do M39 (onda 1) na cópia, tudo em transação DESFEITA e sob a trava da cópia:
//   (1) a lista para ligar o setor (SGH_CFG_COEX_LIGAR, 0390): grava e lê; o banco recusa o item das operações (é
//       calculado) e o item cumprido sem data, cada um pelo CHECK com o nome dele;
//   (2) o uso do dia com as recusas por horário ocupado (0391): a disputa é incremento somado ao gravado do dia;
//   (3) senhas chamadas por sistema: a medida conta um dia real da cópia (só COUNT) em menos de 1 s;
//   (4) regra 2: o outro sistema ocupa o horário (escritor legado simulado, como ele grava na grade) entre a leitura das
//       vagas e a gravação do novo: o novo recusa com "horário ocupado" (o código que o indicador de disputa conta; a
//       gravação de teste não entra nas contagens do dia) e a vaga seguinte grava;
//   (5) regra 3: o outro sistema chama a primeira senha da fila; o chamador do novo passa à seguinte em menos de 1 s;
//   (6) a vigilância diária da onda 1 (D-VIGIA-39) sobre as gravações reais do executor na transação (cadastro,
//       marcação e senha): 0 divergência; a linha adulterada pelo outro sistema simulado (uma coluna que o banco
//       preencheu, esvaziada) é apontada; a operação que só altera linha viva sai "fora da amostra" com o motivo.
// Massa sintética (operador, paciente e senhas pelo executor); saída só com contagens e códigos.
import { VIGIA_IMUTAVEL, comparacoesDaReferencia, vigiarHospitalDia } from '@sgh/dominio-config';
import {
  carregarDominiosVistos,
  contarUsoDoDia,
  diaCivil,
  ErroOperacao,
  fonteCatalogoArquivo,
  fonteVigiaLegado,
  gravarItensLigar,
  gravarUsoDia,
  lerItensLigar,
  lerUsoDia,
  MEDIDAS_USO,
  MetricasExecutor,
  OPERACOES,
  operacao,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agendaLivre,
  convenioAceito,
  diaUtil,
  entradaGrade,
  legadoOcupaHorario,
  relogio,
} from '../massa/reproducao-agenda.js';
import { gravarItemLigarPorFora, outroSistemaEsvaziaColuna } from '../massa/onda1-outro-sistema.js';
import { geradorLivre, guicheLivre, legadoChamaSenha } from '../massa/reproducao-recepcao.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  CATALOGO,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * A restrição CHECK do banco que recusou (só o nome dela, da mensagem do Firebird; nenhum valor de linha), ou outro
 * desfecho: a prova é do CHECK certo, não de qualquer erro (revisão do M39).
 */
async function restricao(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const nome = /CHECK constraint "?(SGH_CK_[A-Z_]+)"?/i.exec(msg)?.[1];
    return nome ? `check: ${nome.toUpperCase()}` : `outro: ${(e as Error).name}`;
  }
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('onda 1 na cópia (M39, transação desfeita)', () => {
  let a: Ambiente;
  const metricas = new MetricasExecutor();
  let executor: Ambiente['executor'];
  const tiposLogradouro =
    carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
    new Set<string>();

  beforeAll(async () => {
    a = await prepararAmbiente();
    // O executor com as contagens do processo (como o da API): os indicadores de disputa vêm dele.
    executor = a.nucleo.criarExecutor({ catalogo: fonteCatalogoArquivo(CATALOGO), metricas });
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    return login;
  }

  it('lista para ligar o setor: grava e lê; o banco recusa o item calculado e o cumprido sem data', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await gravarItensLigar(
        e,
        a.cod,
        'agendamento',
        [
          {
            item: 'aceite-jornada',
            situacao: 'cumprido',
            evidencia: 'docs/homologacao/pc/ata.md',
            em: '2026-11-09',
          },
          { item: 'tvs', situacao: 'pendente', evidencia: '', em: null },
        ],
        'SGH.TESTE',
      );
      // Regravar o mesmo item é UPDATE (sem duplicar).
      await gravarItensLigar(
        e,
        a.cod,
        'agendamento',
        [{ item: 'tvs', situacao: 'nao-se-aplica', evidencia: 'sem TV no setor', em: '2026-11-09' }],
        'SGH.TESTE',
      );
      const lidos = (await lerItensLigar(e, a.cod)).filter((x) => x.setor === 'agendamento');
      const insere = (item: string, situacao: string, em: string | null) =>
        restricao(gravarItemLigarPorFora(e, a.cod, item, situacao, em));
      return {
        lidos: lidos.map((x) => `${x.item}=${x.situacao}@${x.em}`).sort(),
        calculado: await insere('operacoes-conferidas', 'cumprido', '2026-11-09'),
        semData: await insere('leitores', 'cumprido', null),
      };
    });
    expect(r.lidos).toEqual(['aceite-jornada=cumprido@2026-11-09', 'tvs=nao-se-aplica@2026-11-09']);
    expect(r.calculado).toBe('check: SGH_CK_COEX_LIGAR_ITEM');
    expect(r.semData).toBe('check: SGH_CK_COEX_LIGAR_EVIDENCIA');
    console.log(`[${a.cod}] lista para ligar: ${JSON.stringify(r)}`);
  });

  it('uso do dia: a disputa é incremento somado ao gravado do dia (a reinicialização não perde o contado)', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const dia = '2099-01-04';
      const linha = (recusasOcupado: number, colisoes: number) => ({
        dia,
        setor: 'agendamento',
        operacao: 'agenda.agendarConsulta',
        noNovo: 1,
        noLegado: 2,
        colisoes,
        esperasTrava: 1,
        recusasOcupado,
      });
      // O primeiro retrato (insere) e o segundo, depois de a API reiniciar (o processo novo manda o que contou).
      await gravarUsoDia(e, a.cod, [linha(4, 3)]);
      await gravarUsoDia(e, a.cod, [linha(2, 5)]);
      return (await lerUsoDia(e, a.cod, dia)).find((u) => u.operacao === 'agenda.agendarConsulta');
    });
    expect(r).toMatchObject({ recusasOcupado: 6, colisoes: 8, esperasTrava: 2, noNovo: 1, noLegado: 2 });
  });

  it('senhas chamadas por sistema: a medida conta um dia real da cópia em menos de 1 s', async () => {
    const m = MEDIDAS_USO.find((x) => x.operacao === 'recepcao.chamarSenha')!;
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar('SELECT CAST(MAX(DATA_SENHA) AS VARCHAR(10)) D FROM TBSENHAATEND', [], {
        teto: 1,
      });
      const dia = String(x?.['D'] ?? '').slice(0, 10);
      const inicio = performance.now();
      const c = await contarUsoDoDia(l, a.cod, m, dia);
      return { ...c, ms: performance.now() - inicio };
    });
    expect(r.linhasDoDia).toBeGreaterThan(0);
    expect(r.ms).toBeLessThan(1_000);
    console.log(
      `[${a.cod}] senhas chamadas no último dia da cópia: ${r.linhasDoDia < 5 ? '<5' : r.linhasDoDia} (novo ${r.doNovo}); ${Math.round(r.ms)} ms`,
    );
  });

  it('regra 2 e 3, disputa e vigilância: o outro sistema ocupa o horário e chama a senha; a vigilância confere', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      // Cadastro e agenda pelo executor (as gravações que a vigilância vai amostrar).
      const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const cadastro = await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
      const pac = num(cadastro.resultado['idPaciente']);
      const ag = await agendaLivre(e);
      const hoje = (await relogio(e)).hoje;
      const dia = await diaUtil(e, ag, somar(hoje, 7));
      await exec('agenda.gerarGrade', entradaGrade(ag, dia));
      const conv = await convenioAceito(e, ag);
      const base = {
        agenda: ag.id,
        data: dia,
        paciente: pac,
        convenio: conv,
        retorno: false,
        canal: 'telefone',
      };
      // Regra 2: o outro sistema ocupa 07:15 depois de o novo ler as vagas: o novo relê e recusa.
      await legadoOcupaHorario(e, ag, dia, '0715', usuario);
      const colisao = await codigo(exec('agenda.agendarConsulta', { ...base, hora: '0715' }));
      const marcada = await exec('agenda.agendarConsulta', { ...base, hora: '0730' });
      const disputa = metricas
        .doDia(diaCivil(new Date()))
        .find((x) => x.operacao === 'agenda.agendarConsulta' && x.hospital === a.cod);
      // Regra 3: duas senhas na fila; o outro sistema chama a primeira; o novo chama pela fila e leva a segunda.
      const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
      const s1 = num(
        (await exec('recepcao.emitirSenha', { gerador: g.id, prioridade: '2', origem: 'balcao' })).resultado[
          'senha'
        ],
      );
      const s2 = num(
        (await exec('recepcao.emitirSenha', { gerador: g.id, prioridade: '2', origem: 'balcao' })).resultado[
          'senha'
        ],
      );
      await legadoChamaSenha(e, s1, 99, await operador(e));
      const guiche = await guicheLivre(e, g.recepcao, g.local);
      await exec('recepcao.abrirGuiche', { recepcao: g.recepcao, local: g.local, guiche });
      const inicio = performance.now();
      const chamada = await exec('recepcao.chamarSenha', {
        recepcao: g.recepcao,
        local: g.local,
        guiche,
        geradores: [g.id],
      });
      const msChamada = performance.now() - inicio;
      // Vigilância da onda 1 sobre as gravações do executor nesta transação (a SGH_TRILHA do dia).
      const fonte = (ler: Escritor) =>
        fonteVigiaLegado({
          ler: (fn) => fn(ler),
          hospital: a.cod,
          data: hoje,
          pastaSrc: resolve(import.meta.dirname, '../../../legado/src'),
          grupoDe: (op) => OPERACOES[op]?.receita.grupo ?? null,
          cenarioDoCodigo: () => null,
          comparacoes: comparacoesDaReferencia,
          imutavel: VIGIA_IMUTAVEL,
        });
      const operacoes = [
        'cadastro.cadastrarPaciente',
        'agenda.agendarConsulta',
        'recepcao.emitirSenha',
        'recepcao.chamarSenha',
      ];
      const vigia = await vigiarHospitalDia({
        hospital: a.cod,
        data: hoje,
        tamanho: 50,
        operacoes,
        ...fonte(e),
      });
      // O outro sistema simulado esvazia uma coluna imutável (que o banco preencheu ou copiou) de uma gravação do novo
      // (a gravação adulterada): a primeira coluna da referência imutável que aceita nulo, na marcação, no cadastro ou
      // na senha (nunca a chave).
      const alvos = [
        {
          op: 'agenda.agendarConsulta',
          tabela: 'REPACAGD',
          chave: 'ID',
          id: num(marcada.resultado['marcacao']),
        },
        { op: 'cadastro.cadastrarPaciente', tabela: 'RICADPAC', chave: 'ID', id: pac },
        { op: 'recepcao.emitirSenha', tabela: 'TBSENHAATEND', chave: 'ID', id: s2 },
      ];
      let adulterada: { operacao: string; divergentes: number; elementos: string[] } | null = null;
      for (const x of alvos) {
        const ref = fonte(e).referencias(x.op)[VIGIA_IMUTAVEL.cenario];
        const cols = Object.keys(ref?.tabelas[0]?.colunas ?? {}).filter((c) => c !== x.chave);
        if (cols.length === 0) continue;
        const [nula] = await e.consultar(
          `SELECT FIRST 1 TRIM(rf.RDB$FIELD_NAME) C FROM RDB$RELATION_FIELDS rf
            WHERE rf.RDB$RELATION_NAME = ? AND TRIM(rf.RDB$FIELD_NAME) IN (${cols.map(() => '?').join(', ')})
              AND COALESCE(rf.RDB$NULL_FLAG, 0) = 0 AND rf.RDB$DEFAULT_SOURCE IS NULL
            ORDER BY rf.RDB$FIELD_POSITION`,
          [x.tabela, ...cols],
          { teto: 1 },
        );
        const coluna = String(nula?.['C'] ?? '');
        if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(coluna)) continue;
        const n = await outroSistemaEsvaziaColuna(e, x.tabela, coluna, x.chave, x.id);
        if (n !== 1) continue;
        const v2 = await vigiarHospitalDia({
          hospital: a.cod,
          data: hoje,
          tamanho: 50,
          operacoes: [x.op],
          ...fonte(e),
        });
        const y = v2.resultados[0];
        adulterada = {
          operacao: x.op,
          divergentes: y?.divergentes ?? -1,
          elementos: (y?.elementos ?? []).map((z) => `${z.tabela}.${z.coluna}:${z.tipo}`),
        };
        break;
      }
      return {
        colisao,
        marcou: num(marcada.resultado['marcacao']) > 0,
        recusasOcupado: disputa?.recusasPorCodigo['horario-ocupado'] ?? 0,
        chamouASegunda: num(chamada.resultado['senha']) === s2,
        chamadaMenosDe1s: msChamada < 1_000,
        vigia: vigia.resultados.map(
          (x) => `${x.operacao}:${x.amostradas >= 1 ? 'amostrada' : 'vazia'}:${x.divergentes}`,
        ),
        foraDaAmostra: vigia.foraDaAmostra.map((x) => x.operacao),
        semLocalizador: vigia.semLocalizador,
        adulterada,
      };
    });
    expect(r).toMatchObject({
      colisao: 'horario-ocupado',
      marcou: true,
      // A gravação na transação de teste (escritor de quem chama) não é desfecho real: não entra nas contagens do
      // dia (as contagens da produção vêm do executor da API; provadas no teste da API e no unitário do executor).
      recusasOcupado: 0,
      chamouASegunda: true,
      chamadaMenosDe1s: true,
      foraDaAmostra: ['recepcao.chamarSenha'],
      semLocalizador: [],
    });
    expect(r.vigia).toEqual([
      'agenda.agendarConsulta:amostrada:0',
      'cadastro.cadastrarPaciente:amostrada:0',
      'recepcao.emitirSenha:amostrada:0',
    ]);
    // A adulteração sempre roda (alguma coluna imutável aceita nulo) e é apontada com a tabela e a coluna.
    expect(r.adulterada).not.toBeNull();
    expect(r.adulterada!.divergentes).toBe(1);
    expect(r.adulterada!.elementos).toHaveLength(1);
    expect(r.adulterada!.elementos[0]).toMatch(/^(REPACAGD|RICADPAC|TBSENHAATEND)\.[A-Z_]+:colunas$/);
    console.log(`[${a.cod}] adulterada: ${JSON.stringify(r.adulterada)}`);
    console.log(`[${a.cod}] onda 1: ${JSON.stringify(r)}`);
  }, 300_000);
});
