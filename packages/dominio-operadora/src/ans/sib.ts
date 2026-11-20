// SIB, o cadastro de beneficiários na ANS (M56, etapa 7, F6; regra 7). O movimento de cada beneficiário sai do cadastro
// atual contra o último retrato aceito pela ANS (SGH_OPE_BENEF_SIB.ENVIADO), sem fila de eventos nas fatias anteriores:
//   - sem retrato aceito: inclusão (o excluído que nunca foi à ANS não vai);
//   - aceito ativo e agora excluído: cancelamento, com o motivo do SIB (CDMOTMOVIMCAD 5 a 10);
//   - aceito cancelado e agora ativo (ou suspenso): reativação;
//   - plano ou contrato trocados: mudança contratual;
//   - outro campo do SIB mudou: retificação, com os campos (PSSIBCAMPOALT).
// O cartão de desconto não é plano e não vai ao SIB (regra 2). A conferência de cada beneficiário (CPF a partir de 18
// anos, CNS ou DNV do menor sem CPF, endereço, registro do plano, CCO para o que não é inclusão, motivo do cancelamento,
// CNPJ do contratante coletivo, titular com CCO) só tira o beneficiário do arquivo: os outros seguem. O retorno da ANS
// dá o CCO do incluído e torna o retrato enviado o aceito.
import {
  CAMPOS_SIB,
  type CampoSib,
  LEIAUTE_ANS,
  MOTIVO_INCLUSAO_SIB,
  MOTIVO_MUDANCA_SIB,
  MOTIVO_REATIVACAO_SIB,
  MOTIVO_RETIFICACAO_SIB,
  MOVIMENTOS_SIB,
  type MovimentoSib,
  PARAMETROS_ANS,
  type ProblemaAns,
  ROTULOS_CAMPO_SIB,
} from '@sgh/contratos';
import { cnsValido, cpfValido } from '../documentos.js';
import { IDADE_CPF_OBRIGATORIO } from '../beneficiario.js';
import { idadeEm } from '../plano.js';
import { documentoXml, el, type ElementoXml, opcional, problema } from './comum.js';

export interface ComplementoSibDados {
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipio: number | null;
  readonly cep: string | null;
  readonly resideExterior: boolean;
  readonly dnv: string | null;
  readonly coberturaParcial: boolean;
  readonly itensExcluidos: boolean;
  readonly cco: string | null;
  readonly motivoCancelamento: number | null;
}

export interface BeneficiarioSib {
  readonly id: number;
  readonly carteirinha: string;
  readonly nome: string;
  readonly nascimento: string;
  readonly sexo: 'F' | 'M' | 'I';
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nomeMae: string;
  /** 1 titular; 2 a 8 dependente. */
  readonly vinculo: number;
  readonly titular: { readonly id: number; readonly carteirinha: string; readonly cco: string | null } | null;
  readonly inclusao: string;
  readonly situacao: 'ativo' | 'suspenso' | 'excluido';
  readonly exclusao: string | null;
  readonly produto: {
    readonly id: number;
    readonly natureza: 'plano' | 'cartaoDesconto';
    readonly registroAns: string | null;
  };
  /** 1 pessoa física; 2 coletivo (pessoa jurídica). */
  readonly contrato: {
    readonly id: number;
    readonly numero: string;
    readonly tipo: number;
    readonly contratanteDoc: string;
  };
  readonly complemento: ComplementoSibDados | null;
}

/** O retrato do beneficiário como vai ao arquivo (e como fica guardado quando a ANS aceita). */
export interface RetratoSib {
  readonly ativo: boolean;
  readonly plano: string | null;
  readonly contrato: string;
  readonly contratante: string | null;
  readonly campos: Readonly<Record<CampoSib, string | null>>;
}

const s = (v: string | number | boolean | null | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 'S' : 'N') : String(v);

export function retratoSib(b: BeneficiarioSib): RetratoSib {
  const c = b.complemento;
  return {
    ativo: b.situacao !== 'excluido',
    plano: b.produto.registroAns,
    contrato: b.contrato.numero,
    contratante: b.contrato.tipo === 2 ? b.contrato.contratanteDoc : null,
    campos: {
      matricula: b.carteirinha,
      nome: b.nome,
      nascimento: b.nascimento,
      sexo: b.sexo,
      cpf: s(b.cpf),
      nomeMae: b.nomeMae,
      dnv: s(c?.dnv),
      cns: s(b.cns),
      titular: b.titular?.carteirinha ?? null,
      logradouro: s(c?.logradouro),
      numero: s(c?.numero),
      complemento: s(c?.complemento),
      bairro: s(c?.bairro),
      municipio: s(c?.municipio),
      cep: s(c?.cep),
      resideExterior: s(c?.resideExterior ?? false),
      adesao: b.inclusao,
      vinculo: String(b.vinculo),
      caepf: null,
    },
  };
}

/** Os campos do SIB que mudaram entre o retrato aceito e o atual, na ordem de PSSIBCAMPOALT. */
export function camposAlterados(aceito: RetratoSib, atual: RetratoSib): CampoSib[] {
  return (Object.keys(CAMPOS_SIB) as CampoSib[]).filter(
    (k) => (aceito.campos[k] ?? null) !== (atual.campos[k] ?? null),
  );
}

export interface MovimentoDerivado {
  readonly movimento: MovimentoSib;
  readonly campos: readonly CampoSib[];
}

/** O movimento do beneficiário (null: nada a enviar). */
export function movimentoSib(b: BeneficiarioSib, aceito: RetratoSib | null): MovimentoDerivado | null {
  if (b.produto.natureza !== 'plano') return null;
  const atual = retratoSib(b);
  if (!aceito) return atual.ativo ? { movimento: 'inclusao', campos: [] } : null;
  if (aceito.ativo && !atual.ativo) return { movimento: 'cancelamento', campos: [] };
  if (!aceito.ativo) return atual.ativo ? { movimento: 'reativacao', campos: [] } : null;
  if (
    aceito.plano !== atual.plano ||
    aceito.contrato !== atual.contrato ||
    aceito.contratante !== atual.contratante
  )
    return { movimento: 'mudancaContratual', campos: [] };
  const campos = camposAlterados(aceito, atual);
  return campos.length ? { movimento: 'retificacao', campos } : null;
}

/** Município do IBGE: 7 dígitos, com a UF de 11 a 53. */
export const municipioValido = (m: number | null | undefined): boolean =>
  typeof m === 'number' && Number.isInteger(m) && m >= 1_100_000 && m <= 5_399_999;

/** UF (código do IBGE, 2 dígitos) do município; null sem município. */
export const ufDoMunicipio = (m: number | null | undefined): string | null =>
  municipioValido(m) ? String(m).slice(0, 2) : null;

/** CCO: 12 dígitos (o dígito verificador é da ANS, que confere no recebimento). */
export const ccoValido = (v: string | null | undefined): boolean =>
  typeof v === 'string' && /^\d{12}$/.test(v);

/** CCO SINTÉTICO do simulador (fora de produção): 99 e o ID do beneficiário em 10 dígitos. */
export const ccoSimulado = (beneficiario: number): string =>
  `99${String(beneficiario % 1e10).padStart(10, '0')}`;

/**
 * A conferência do beneficiário no movimento. `titularesNoArquivo` são os titulares incluídos neste mesmo arquivo (o
 * dependente vai junto, logo depois do titular).
 */
export function problemasSib(
  b: BeneficiarioSib,
  m: MovimentoDerivado,
  hoje: string,
  titularesNoArquivo: ReadonlySet<number> = new Set(),
): ProblemaAns[] {
  const ref = b.carteirinha;
  const p: ProblemaAns[] = [];
  const item = (c: string) => p.push(problema(c, 'item', ref));
  const c = b.complemento;
  if (!b.produto.registroAns) item('sem-registro-plano');
  if (m.movimento !== 'cancelamento') {
    const idade = idadeEm(b.nascimento, hoje);
    if (b.cpf && !cpfValido(b.cpf)) item('cpf-invalido');
    if (!b.cpf && idade >= IDADE_CPF_OBRIGATORIO) item('cpf-obrigatorio');
    if (!b.cpf && idade < IDADE_CPF_OBRIGATORIO && !b.cns && !c?.dnv) item('sem-identificacao-menor');
    if (b.cns && !cnsValido(b.cns)) item('cns-invalido');
    if (!c?.resideExterior) {
      if (!c?.logradouro || !c.bairro || c.municipio === null || !c.cep) item('sem-endereco');
      else if (!municipioValido(c.municipio)) item('municipio-invalido');
    }
    if (b.contrato.tipo === 2 && !/^\d{14}$|^[0-9A-Z]{12}\d{2}$/.test(b.contrato.contratanteDoc))
      item('contratante-sem-cnpj');
    if (b.vinculo !== 1 && b.titular && !b.titular.cco && !titularesNoArquivo.has(b.titular.id))
      item('titular-sem-cco');
  }
  if (m.movimento !== 'inclusao') {
    if (!c?.cco) item('sem-cco');
    else if (!ccoValido(c.cco)) item('cco-invalido');
  }
  if (m.movimento === 'cancelamento' && !c?.motivoCancelamento) item('sem-motivo-cancelamento');
  return p;
}

export interface MovimentoNoArquivo {
  readonly ordem: number;
  readonly beneficiario: BeneficiarioSib;
  readonly movimento: MovimentoDerivado;
  readonly retrato: RetratoSib;
}

export interface SelecaoSib {
  readonly movimentos: readonly MovimentoNoArquivo[];
  /** Os que ficaram de fora pela conferência, com os problemas. */
  readonly pendentes: readonly {
    readonly beneficiario: BeneficiarioSib;
    readonly movimento: MovimentoDerivado;
    readonly problemas: readonly ProblemaAns[];
  }[];
  /** Os que ficaram para o arquivo seguinte (teto do arquivo). */
  readonly excedentes: number;
}

/**
 * Seleciona os movimentos do arquivo: titulares antes dos dependentes (o dependente da inclusão do titular vai no mesmo
 * arquivo), o beneficiário com problema fica de fora, e o teto do arquivo manda o resto para o seguinte.
 */
export function selecionarMovimentosSib(
  beneficiarios: readonly BeneficiarioSib[],
  aceitos: ReadonlyMap<number, RetratoSib>,
  hoje: string,
  teto: number = PARAMETROS_ANS.maximoMovimentosSib,
): SelecaoSib {
  const candidatos = beneficiarios
    .map((b) => ({ b, m: movimentoSib(b, aceitos.get(b.id) ?? null) }))
    .filter((x): x is { b: BeneficiarioSib; m: MovimentoDerivado } => x.m !== null)
    .sort(
      (x, y) =>
        (x.b.titular?.id ?? x.b.id) - (y.b.titular?.id ?? y.b.id) ||
        (x.b.vinculo === 1 ? 0 : 1) - (y.b.vinculo === 1 ? 0 : 1) ||
        x.b.id - y.b.id,
    );
  const titulares = new Set<number>();
  const movimentos: MovimentoNoArquivo[] = [];
  const pendentes: SelecaoSib['pendentes'][number][] = [];
  let excedentes = 0;
  for (const { b, m } of candidatos) {
    const ps = problemasSib(b, m, hoje, titulares);
    if (ps.length) {
      pendentes.push({ beneficiario: b, movimento: m, problemas: ps });
      continue;
    }
    if (movimentos.length >= teto) {
      excedentes += 1;
      continue;
    }
    if (b.vinculo === 1 && m.movimento === 'inclusao') titulares.add(b.id);
    movimentos.push({ ordem: movimentos.length + 1, beneficiario: b, movimento: m, retrato: retratoSib(b) });
  }
  return { movimentos, pendentes, excedentes };
}

const MOTIVO_DO_MOVIMENTO: Readonly<Record<Exclude<MovimentoSib, 'cancelamento'>, number>> = {
  inclusao: MOTIVO_INCLUSAO_SIB,
  retificacao: MOTIVO_RETIFICACAO_SIB,
  mudancaContratual: MOTIVO_MUDANCA_SIB,
  reativacao: MOTIVO_REATIVACAO_SIB,
};

export interface CabecalhoAns {
  readonly registroAns: string;
  readonly cnpj: string;
  readonly competencia: string;
  readonly sequencial: number;
  readonly geradoEm: string;
  readonly destino: 'simulador' | 'ans';
}

export function cabecalhoXml(
  c: CabecalhoAns,
  quantidade: number,
  extra: readonly ElementoXml[] = [],
): ElementoXml {
  return el('cabecalho', [
    el('leiaute', LEIAUTE_ANS),
    el('registroANS', c.registroAns),
    el('cnpjOperadora', c.cnpj),
    el('competencia', c.competencia),
    el('sequencial', c.sequencial),
    el('dataGeracao', c.geradoEm),
    el('ambiente', c.destino === 'ans' ? 'producao' : 'simulador'),
    el('quantidadeRegistros', quantidade),
    ...extra,
  ]);
}

function dadosDoBeneficiario(r: RetratoSib, b: BeneficiarioSib): (ElementoXml | null)[] {
  const c = r.campos;
  const comp = b.complemento;
  return [
    el('matricula', c.matricula),
    el('nome', c.nome),
    el('dataNascimento', c.nascimento),
    el('sexo', c.sexo),
    opcional('cpf', c.cpf),
    opcional('cns', c.cns),
    opcional('dnv', c.dnv),
    el('nomeMae', c.nomeMae),
    el('relacaoDependencia', c.vinculo),
    opcional('matriculaTitular', c.titular),
    opcional('ccoTitular', b.titular?.cco ?? null),
    el('endereco', [
      el('resideExterior', c.resideExterior),
      opcional('logradouro', c.logradouro),
      opcional('numero', c.numero),
      opcional('complemento', c.complemento),
      opcional('bairro', c.bairro),
      opcional('codigoMunicipio', c.municipio),
      opcional('cep', c.cep),
    ]),
    el('vinculo', [
      el('numeroPlanoANS', r.plano),
      el('dataContratacao', c.adesao),
      el('numeroContrato', r.contrato),
      opcional('cnpjContratante', r.contratante),
      el('coberturaParcialTemporaria', comp?.coberturaParcial ? 'S' : 'N'),
      el('itensExcluidosCobertura', comp?.itensExcluidos ? 'S' : 'N'),
    ]),
  ];
}

/** O arquivo do SIB com os movimentos selecionados. */
export function arquivoSib(cab: CabecalhoAns, movimentos: readonly MovimentoNoArquivo[]): string {
  const registros = movimentos.map(({ ordem, beneficiario: b, movimento: m, retrato: r }) => {
    const codigo = MOVIMENTOS_SIB[m.movimento].codigo;
    const comum = { ordem, tipoMovimento: codigo };
    if (m.movimento === 'cancelamento')
      return el(
        'cancelamento',
        [
          el('cco', b.complemento?.cco ?? ''),
          el('matricula', b.carteirinha),
          el('dataCancelamento', b.exclusao ?? ''),
          el('motivoCancelamento', b.complemento?.motivoCancelamento ?? ''),
        ],
        comum,
      );
    return el(
      m.movimento,
      [
        opcional('cco', m.movimento === 'inclusao' ? null : (b.complemento?.cco ?? null)),
        el('motivo', MOTIVO_DO_MOVIMENTO[m.movimento]),
        m.campos.length
          ? el(
              'camposAlterados',
              m.campos.map((k) => el('campo', CAMPOS_SIB[k])),
            )
          : null,
        ...dadosDoBeneficiario(r, b),
      ],
      comum,
    );
  });
  return documentoXml(
    el('mensagemSIB', [cabecalhoXml(cab, movimentos.length), el('beneficiarios', registros)]),
  );
}

/** Descrição curta do movimento (a tela e o item do envio). */
export function descricaoMovimentoSib(m: MovimentoDerivado): string {
  const r = MOVIMENTOS_SIB[m.movimento].rotulo;
  return m.campos.length ? `${r}: ${m.campos.map((k) => ROTULOS_CAMPO_SIB[k]).join(', ')}` : r;
}
