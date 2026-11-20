// Apoio das integrações da F8 na cópia (M53.9; titulos-folha e outbox-custo-pessoal): o serviço REAL da integração da
// folha sobre a porta na transação desfeita (de-para em SGH_, títulos pelo executor `financeiro.criarTituloPagar`, ação
// `incluir-folha`, registro SGH_PES_FOLHA_* e a outbox), com o período fechado SINTÉTICO (fechamento e processamento
// dublês: ID e período fora de qualquer folha real; os valores, centavos sintéticos) e o credor, a classificação e o
// centro de custo lidos da cópia (só códigos). O login é o de um usuário ativo da cópia (só em memória, nunca impresso).
import type { DestinoIntegracaoFolha, TotaisCalculoFolha } from '@sgh/contratos';
import type { ChaveGravada, Escritor, FechamentoFolhaLido, PrerequisitoGravado } from '@sgh/legado';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { type AmbienteM27, usuariosAtivos } from '../../acesso/aplicacao/copia.spec-util.js';
import type { PortaCalculoFolha } from '../folha/porta-calculo.js';
import type { PortaFolha } from '../folha/porta-folha.js';
import { portaIntegracaoFolhaNaTransacao } from '../folha/porta-integracao-legado.js';
import { ServicoIntegracaoFolha } from '../folha/servico-integracao.js';

/** Período sintético (nenhuma folha real chega a 2099). */
export const PERIODO_SINTETICO = '2099-11';

const SQL_FORNECEDOR = `SELECT FIRST 1 c.FORN FROM MFCONPAG c WHERE c.ONDE = 'F' AND c.TIPO = 'F' AND c.EMISSAO >= '2026-01-01'
  AND EXISTS (SELECT 1 FROM TBFORNEC f WHERE f.COD = c.FORN) ORDER BY c.ID DESC`;
const SQL_CLASSIFICACAO = `SELECT FIRST 1 g.GRUPO, g.SUBGRUPO, g.ITEM FROM MFLANGSI g WHERE g.TP_LAN = 0 AND g.DATA >= '2026-01-01'
  AND EXISTS (SELECT 1 FROM TBITEDES t WHERE t.GRUPO = g.GRUPO AND t.SUBGRUPO = g.SUBGRUPO AND t.ITEM = g.ITEM) ORDER BY g.DATA DESC`;
const SQL_CENTRO = "SELECT FIRST 2 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') = 'A' ORDER BY COD";

const n = (v: unknown) => Number(v ?? 0);
const somarDias = (d: string, k: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
};

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração na cópia (desfeita)',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-28T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração na cópia (desfeita)',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-28T10:00:00',
});

const totais = (x: Partial<TotaisCalculoFolha>): TotaisCalculoFolha => ({
  colaboradores: 2,
  proventos: 0,
  descontos: 0,
  liquido: 0,
  inss: 0,
  irrf: 0,
  fgts: 0,
  inssPatronal: 0,
  rat: 0,
  terceiros: 0,
  ...x,
});

export interface CenarioTitulosFolha {
  readonly servico: ServicoIntegracaoFolha;
  /** O mesmo serviço (mesmos dublês, mesma origem) sobre outro escritor da mesma transação. */
  readonly servicoSobre: (e: Escritor) => ServicoIntegracaoFolha;
  readonly sessao: () => SessaoCadastro;
  readonly origem: number;
  readonly hoje: string;
  readonly credor: number;
  readonly centros: readonly number[];
}

/**
 * O cenário sobre a transação `e` (desfeita por quem chama): a folha sintética de dois colaboradores em dois centros
 * (líquido R$ 4.200,00, INSS R$ 500,00, FGTS R$ 400,00; sem IRRF e sem a parte da empresa do INSS), o de-para gravado
 * pelo serviço (líquido, INSS e FGTS no credor e na classificação lidos da cópia).
 */
export async function cenarioTitulosFolha(
  a: AmbienteM27,
  e: Escritor,
  escritorDaPorta: Escritor = e,
): Promise<CenarioTitulosFolha> {
  const [h] = await e.consultar('SELECT CURRENT_DATE H FROM RDB$DATABASE', [], { teto: 1 });
  const hoje = new Date(h?.['H'] as Date).toISOString().slice(0, 10);
  const [f] = await e.consultar(SQL_FORNECEDOR, [], { teto: 1, tempoMaximoMs: 120_000 });
  const [c] = await e.consultar(SQL_CLASSIFICACAO, [], { teto: 1, tempoMaximoMs: 120_000 });
  const cs = await e.consultar(SQL_CENTRO, [], { teto: 2 });
  const credor = n(f?.['FORN']);
  const classificacao = { grupo: n(c?.['GRUPO']), subgrupo: n(c?.['SUBGRUPO']), item: n(c?.['ITEM']) };
  const centros = cs.map((x) => n(x['COD']));
  if (!credor || !classificacao.grupo || centros.length < 2)
    throw new Error('Cópia sem credor, classificação ou centros de custo de partida.');
  const login = (await usuariosAtivos(e)).a;
  const origem = 1_900_000_000 + (Date.now() % 99_999_999);
  const pagamento = somarDias(hoje, 5);
  const fechamento = {
    id: origem,
    empresa: 1,
    apuracao: 'mensal',
    periodo: PERIODO_SINTETICO,
    numero: 1,
    situacao: 'fechada',
    pagamento,
    processos: [{ id: 1, tipo: 'mensal', competencia: PERIODO_SINTETICO, numero: 1, pagamento }],
    totais: {
      processos: 1,
      proventos: 520_000,
      descontos: 100_000,
      liquido: 420_000,
      inss: 50_000,
      irrf: 0,
      fgts: 40_000,
      encargos: 90_000,
    },
    resumo: 'r',
    fechadoPor: 'SGH.TESTE',
    fechadoEm: `${hoje}T10:00:00`,
    reabertoPor: null,
    reabertoEm: null,
    motivo: null,
    versao: 0,
  } as unknown as FechamentoFolhaLido;
  const calculo = {
    fechamento: async (_c: unknown, id: number) => (id === origem ? fechamento : null),
    processo: async () => ({
      totais: totais({
        proventos: 520_000,
        descontos: 100_000,
        liquido: 420_000,
        inss: 50_000,
        fgts: 40_000,
      }),
    }),
    resumoVinculos: async () => [
      {
        vinculo: 1,
        centroCusto: centros[0],
        diasPagos: 30,
        proventos: 312_000,
        descontos: 60_000,
        porPapel: { fgts: 24_000, inssPatronal: 0, rat: 0, terceiros: 0 },
      },
      {
        vinculo: 2,
        centroCusto: centros[1],
        diasPagos: 30,
        proventos: 208_000,
        descontos: 40_000,
        porPapel: { fgts: 16_000, inssPatronal: 0, rat: 0, terceiros: 0 },
      },
    ],
  } as unknown as PortaCalculoFolha;
  const folha = {
    empresas: async () => [{ codigo: 1, rotulo: 'EMPRESA' }],
    relogio: async () => ({ hoje, agora: `${hoje}T10:00:00` }),
  } as unknown as PortaFolha;
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => [chave('pessoas.folha')],
    prerequisitosIniciais: () => [cumprido('pessoas.folha')],
  });
  const servicoSobre = (esc: Escritor) =>
    new ServicoIntegracaoFolha(
      portaIntegracaoFolhaNaTransacao(esc, a.executor),
      calculo,
      folha,
      trilha,
      config,
      null,
    );
  const servico = servicoSobre(escritorDaPorta);
  let k = 0;
  const sessao = (): SessaoCadastro => ({
    req: {
      headers: { 'idempotency-key': `int-m539-${origem}-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: a.c.hospital,
    rede: a.c.rede,
    login,
    porta: a.c,
    pode: () => true,
  });
  const dp = (destino: DestinoIntegracaoFolha['destino']): DestinoIntegracaoFolha => ({
    destino,
    credor,
    classificacao,
    diaVencimento: 20,
    mesesDepois: 1,
    contaContabil: '',
  });
  await servico.gravarIntegracao(sessao(), {
    empresa: 1,
    inicio: '2001-02-03',
    destinos: [dp('liquido-mensal'), dp('inss'), dp('fgts')],
  });
  return { servico, servicoSobre, sessao, origem, hoje, credor, centros };
}

/** Lança a folha sintética com os vencimentos dos encargos trazidos para perto de hoje (vencimento ajustado). */
export async function lancarFolhaSintetica(x: CenarioTitulosFolha) {
  const p = await x.servico.previa(x.sessao(), { empresa: 1, origem: 'fechamento', id: x.origem });
  return {
    previa: p,
    lancar: () =>
      x.servico.lancar(x.sessao(), {
        empresa: 1,
        origem: 'fechamento',
        id: x.origem,
        resumo: p.resumo,
        emissao: x.hoje,
        vencimentos: p.titulos
          .filter((t) => !t.destino.startsWith('liquido-'))
          .map((t) => ({ chave: t.chave, vencimento: somarDias(x.hoje, 20) })),
      }),
  };
}
