// Cadastro do fornecedor, avaliação periódica e ocorrências (05-SUP linha 23). O fornecedor é um só, compartilhado
// entre suprimentos e o financeiro (empresa_fornecedora): dados fiscais, endereço, contatos por finalidade, categorias
// de fornecimento, autorizações sanitárias com validade e contas bancárias (ou chave Pix) para o pagamento eletrônico.
// Prática de mercado (ONA, ISO 9001 8.4 e RDC 16/2013 da ANVISA: a empresa que fornece medicamento ou material precisa
// de autorização de funcionamento vigente):
//   - o documento confere pelos dígitos verificadores (CNPJ na pessoa jurídica, CPF na física);
//   - a categoria principal está entre as categorias; a categoria que exige autorização sanitária pede uma AFE ou
//     licença sanitária cadastrada (sem trava: a falta vira aviso, a decisão é do hospital);
//   - a autorização mostra a situação no dia (válida, vence em N dias, vencida) pelo aviso de vencimento;
//   - a conta bancária tem banco e conta, ou chave Pix coerente com o tipo; o titular confere pelo CPF ou CNPJ; conta
//     nunca é alterada: inclui-se a nova e inativa-se a antiga (o pagamento já feito continua rastreável);
//   - a avaliação periódica reaproveita a regra do contrato (avaliarFornecedor: quatro critérios de 1 a 5, a média, a
//     nota 1 que desqualifica), com a média do período e a próxima data (o prazo do fornecedor, ou 6 meses para o
//     crítico e 12 para os demais);
//   - a ocorrência (atraso, avaria, não conformidade) segue aberta → notificada → em tratativa → resolvida ou
//     improcedente, ou cancelada; encerrar pede a tratativa; nada é apagado.
// Datas em AAAA-MM-DD. Funções puras: a gravação confere de novo.
import { cnpjValido, cpfValido } from '../../validacao/cpf.js';
import { CRITERIOS_AVALIACAO_FORNECEDOR, type CriterioAvaliacao } from '../contrato.js';
import { avaliarFornecedor, diasEntre, somarMeses } from './contrato.js';
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const FINALIDADES_CONTATO_FORNECEDOR = [
  'comercial',
  'financeiro',
  'entrega',
  'tecnico',
  'sac',
  'outro',
] as const;
export type FinalidadeContatoFornecedor = (typeof FINALIDADES_CONTATO_FORNECEDOR)[number];
export const TIPOS_AUTORIZACAO_FORNECEDOR = [
  'afe',
  'autorizacao_especial',
  'licenca_sanitaria',
  'alvara',
  'certidao_regularidade',
  'registro_conselho',
  'certificado_boas_praticas',
  'outro',
] as const;
export type TipoAutorizacaoFornecedor = (typeof TIPOS_AUTORIZACAO_FORNECEDOR)[number];
export const SITUACOES_AUTORIZACAO_FORNECEDOR = ['valido', 'vencido', 'suspenso', 'cancelado'] as const;
export type SituacaoAutorizacaoFornecedor = (typeof SITUACOES_AUTORIZACAO_FORNECEDOR)[number];
export const SITUACOES_FORNECEDOR = ['ativo', 'bloqueado', 'inativo'] as const;
export type SituacaoFornecedor = (typeof SITUACOES_FORNECEDOR)[number];
export const DISPONIBILIDADES_FORNECEDOR = ['comercial', 'plantao_24h', 'sob_demanda'] as const;
export const TIPOS_CONTA_CREDOR = ['corrente', 'poupanca', 'pagamento', 'salario'] as const;
export const TIPOS_CHAVE_PIX = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const;
export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];
export const TIPOS_OCORRENCIA_FORNECEDOR = [
  'atraso_entrega',
  'avaria',
  'divergencia_quantidade',
  'divergencia_preco',
  'produto_errado',
  'validade_curta',
  'nao_conformidade_qualidade',
  'documentacao',
  'outro',
] as const;
export type TipoOcorrenciaFornecedor = (typeof TIPOS_OCORRENCIA_FORNECEDOR)[number];
export const GRAVIDADES_OCORRENCIA = ['baixa', 'media', 'alta', 'critica'] as const;
export type GravidadeOcorrencia = (typeof GRAVIDADES_OCORRENCIA)[number];
export const SITUACOES_OCORRENCIA_FORNECEDOR = [
  'aberta',
  'notificada',
  'em_tratativa',
  'resolvida',
  'improcedente',
  'cancelada',
] as const;
export type SituacaoOcorrenciaFornecedor = (typeof SITUACOES_OCORRENCIA_FORNECEDOR)[number];

/** As autorizações que valem como autorização sanitária de funcionamento. */
const AUTORIZACOES_SANITARIAS: readonly TipoAutorizacaoFornecedor[] = [
  'afe',
  'autorizacao_especial',
  'licenca_sanitaria',
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const so = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

// ── Cadastro ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ContatoFornecedorEntrada {
  readonly id?: number | null;
  readonly finalidade: FinalidadeContatoFornecedor;
  readonly nome: string | null;
  readonly cargo: string | null;
  readonly telefone: string | null;
  readonly ramal: string | null;
  readonly email: string | null;
  readonly principal: boolean;
}

export interface AutorizacaoFornecedorEntrada {
  readonly id?: number | null;
  readonly tipo: TipoAutorizacaoFornecedor;
  readonly numero: string;
  readonly orgaoEmissor: string | null;
  readonly emitidoEm: string | null;
  readonly validoAte: string | null;
  readonly diasAviso: number;
  readonly bloqueiaCompraVencido: boolean;
  readonly situacao: SituacaoAutorizacaoFornecedor;
}

export interface FornecedorEntrada {
  readonly tipoPessoa: 'juridica' | 'fisica';
  readonly documento: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly inscricaoEstadual: string | null;
  readonly inscricaoMunicipal: string | null;
  readonly optanteSimples: boolean;
  readonly contribuinteIcms: boolean;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numeroEndereco: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly email: string | null;
  readonly site: string | null;
  readonly numeroCnes: string | null;
  readonly prazoEntregaDias: number | null;
  readonly diasValidadeAvaliacao: number | null;
  readonly forneceOpme: boolean;
  readonly transportadora: boolean;
  readonly prestadorServico: boolean;
  readonly disponibilidade: (typeof DISPONIBILIDADES_FORNECEDOR)[number];
  readonly situacao: SituacaoFornecedor;
  readonly motivoSituacao: string | null;
  readonly observacao: string | null;
  readonly categorias: readonly number[];
  readonly categoriaPrincipal: number | null;
  readonly contatos: readonly ContatoFornecedorEntrada[];
  readonly autorizacoes: readonly AutorizacaoFornecedorEntrada[];
}

/** O documento só com dígitos e conferido pelo tipo de pessoa. */
export function documentoFornecedor(tipoPessoa: 'juridica' | 'fisica', documento: string): string | null {
  const d = so(documento);
  if (tipoPessoa === 'juridica') return d.length === 14 && cnpjValido(d) ? d : null;
  return d.length === 11 && cpfValido(d) ? d : null;
}

/** Confere o cadastro inteiro e devolve todas as recusas de uma vez (validação na hora, na tela e na gravação). */
export function conferirFornecedor(e: FornecedorEntrada): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (!documentoFornecedor(e.tipoPessoa, e.documento))
    rs.push(
      recusa(
        'documento-invalido',
        e.tipoPessoa === 'juridica'
          ? 'O CNPJ não confere pelos dígitos verificadores.'
          : 'O CPF não confere pelos dígitos verificadores.',
        ['documento'],
      ),
    );
  if (!e.razaoSocial.trim())
    rs.push(
      recusa('razao-social', e.tipoPessoa === 'juridica' ? 'Informe a razão social.' : 'Informe o nome.', [
        'razaoSocial',
      ]),
    );
  if (e.email && !EMAIL.test(e.email.trim())) rs.push(recusa('email', 'O e-mail não é válido.', ['email']));
  if (e.cep && so(e.cep).length !== 8) rs.push(recusa('cep', 'O CEP tem 8 dígitos.', ['cep']));
  if (e.numeroCnes && !/^\d{7}$/.test(e.numeroCnes.trim()))
    rs.push(recusa('cnes', 'O CNES tem 7 dígitos.', ['numeroCnes']));
  if (e.situacao !== 'ativo' && !e.motivoSituacao?.trim())
    rs.push(
      recusa('motivo-situacao', 'Bloquear ou inativar o fornecedor pede o motivo.', ['motivoSituacao']),
    );
  if (new Set(e.categorias).size !== e.categorias.length)
    rs.push(recusa('categoria-repetida', 'A categoria aparece duas vezes.', ['categorias']));
  if (e.categoriaPrincipal !== null && !e.categorias.includes(e.categoriaPrincipal))
    rs.push(
      recusa('categoria-principal', 'A categoria principal precisa estar entre as categorias.', [
        'categoriaPrincipal',
      ]),
    );
  e.contatos.forEach((c, i) => {
    if (!c.telefone?.trim() && !c.email?.trim())
      rs.push(recusa('contato-meio', `Contato ${i + 1}: informe o telefone ou o e-mail.`, ['contatos']));
    if (c.email?.trim() && !EMAIL.test(c.email.trim()))
      rs.push(recusa('contato-email', `Contato ${i + 1}: o e-mail não é válido.`, ['contatos']));
    if (c.telefone?.trim() && (so(c.telefone).length < 8 || so(c.telefone).length > 13))
      rs.push(
        recusa('contato-telefone', `Contato ${i + 1}: o telefone tem de 8 a 13 dígitos.`, ['contatos']),
      );
  });
  for (const f of FINALIDADES_CONTATO_FORNECEDOR)
    if (e.contatos.filter((c) => c.finalidade === f && c.principal).length > 1)
      rs.push(recusa('contato-principal', 'Só um contato principal por finalidade.', ['contatos']));
  const vistas = new Set<string>();
  e.autorizacoes.forEach((a, i) => {
    const k = `${a.tipo}|${a.numero.trim().toUpperCase()}`;
    if (!a.numero.trim())
      rs.push(recusa('autorizacao-numero', `Autorização ${i + 1}: informe o número.`, ['autorizacoes']));
    else if (vistas.has(k))
      rs.push(recusa('autorizacao-repetida', `Autorização ${i + 1}: repetida.`, ['autorizacoes']));
    vistas.add(k);
    if ((a.emitidoEm && !DATA.test(a.emitidoEm)) || (a.validoAte && !DATA.test(a.validoAte)))
      rs.push(recusa('autorizacao-data', `Autorização ${i + 1}: data inválida.`, ['autorizacoes']));
    else if (a.emitidoEm && a.validoAte && a.validoAte < a.emitidoEm)
      rs.push(
        recusa('autorizacao-vigencia', `Autorização ${i + 1}: a validade vem antes da emissão.`, [
          'autorizacoes',
        ]),
      );
  });
  return rs;
}

export type SituacaoNaDataAutorizacao = 'valida' | 'vencendo' | 'vencida' | 'suspensa' | 'cancelada';

/** A situação da autorização no dia: vencida depois da validade; vencendo dentro do aviso. */
export function situacaoAutorizacaoNaData(
  a: Pick<AutorizacaoFornecedorEntrada, 'validoAte' | 'diasAviso' | 'situacao'>,
  hoje: string,
): { situacao: SituacaoNaDataAutorizacao; dias: number | null } {
  if (a.situacao === 'suspenso') return { situacao: 'suspensa', dias: null };
  if (a.situacao === 'cancelado') return { situacao: 'cancelada', dias: null };
  if (!a.validoAte) return { situacao: a.situacao === 'vencido' ? 'vencida' : 'valida', dias: null };
  const dias = diasEntre(hoje, a.validoAte);
  if (dias < 0 || a.situacao === 'vencido') return { situacao: 'vencida', dias };
  return { situacao: dias <= a.diasAviso ? 'vencendo' : 'valida', dias };
}

export interface AvisoFornecedor {
  readonly codigo: string;
  readonly mensagem: string;
  readonly gravidade: 'informacao' | 'atencao' | 'critico';
}

/** Os avisos do fornecedor no dia (sem trava: a decisão de comprar é do hospital). */
export function avisosFornecedor(o: {
  readonly situacao: SituacaoFornecedor;
  readonly exigeAutorizacaoSanitaria: boolean;
  readonly autorizacoes: readonly (Pick<
    AutorizacaoFornecedorEntrada,
    'tipo' | 'numero' | 'validoAte' | 'diasAviso' | 'situacao' | 'bloqueiaCompraVencido'
  > & { readonly rotulo?: string })[];
  readonly proximaAvaliacao: string | null;
  readonly ultimoResultado: 'qualificado' | 'condicional' | 'desqualificado' | null;
  readonly ocorrenciasAbertas: number;
  readonly ocorrenciasCriticasAbertas: number;
  readonly contasAtivas: number;
  readonly hoje: string;
}): AvisoFornecedor[] {
  const av: AvisoFornecedor[] = [];
  if (o.situacao === 'bloqueado')
    av.push({ codigo: 'bloqueado', mensagem: 'Fornecedor bloqueado.', gravidade: 'critico' });
  if (o.situacao === 'inativo')
    av.push({ codigo: 'inativo', mensagem: 'Fornecedor inativo.', gravidade: 'atencao' });
  for (const a of o.autorizacoes) {
    const s = situacaoAutorizacaoNaData(a, o.hoje);
    const nome = `${a.rotulo ?? a.tipo} ${a.numero}`;
    if (s.situacao === 'vencida')
      av.push({
        codigo: 'autorizacao-vencida',
        mensagem: a.bloqueiaCompraVencido
          ? `${nome} vencida: não emita pedido sem regularizar.`
          : `${nome} vencida.`,
        gravidade: a.bloqueiaCompraVencido ? 'critico' : 'atencao',
      });
    else if (s.situacao === 'vencendo')
      av.push({
        codigo: 'autorizacao-vencendo',
        mensagem: `${nome} vence em ${s.dias} dia(s).`,
        gravidade: 'atencao',
      });
  }
  if (
    o.exigeAutorizacaoSanitaria &&
    !o.autorizacoes.some(
      (a) =>
        AUTORIZACOES_SANITARIAS.includes(a.tipo) &&
        ['valida', 'vencendo'].includes(situacaoAutorizacaoNaData(a, o.hoje).situacao),
    )
  )
    av.push({
      codigo: 'sem-autorizacao-sanitaria',
      mensagem: 'A categoria fornecida exige autorização sanitária vigente (AFE ou licença) e não há uma.',
      gravidade: 'critico',
    });
  if (o.proximaAvaliacao && o.proximaAvaliacao < o.hoje)
    av.push({
      codigo: 'avaliacao-vencida',
      mensagem: `A avaliação periódica venceu em ${o.proximaAvaliacao}.`,
      gravidade: 'atencao',
    });
  if (o.ultimoResultado === 'desqualificado')
    av.push({
      codigo: 'desqualificado',
      mensagem: 'O fornecedor foi desqualificado na última avaliação.',
      gravidade: 'critico',
    });
  if (o.ocorrenciasCriticasAbertas > 0)
    av.push({
      codigo: 'ocorrencia-critica',
      mensagem: `${o.ocorrenciasCriticasAbertas} ocorrência(s) crítica(s) sem solução.`,
      gravidade: 'critico',
    });
  else if (o.ocorrenciasAbertas > 0)
    av.push({
      codigo: 'ocorrencia-aberta',
      mensagem: `${o.ocorrenciasAbertas} ocorrência(s) sem solução.`,
      gravidade: 'informacao',
    });
  if (o.contasAtivas === 0)
    av.push({
      codigo: 'sem-conta',
      mensagem: 'Sem conta bancária ou chave Pix ativa para o pagamento eletrônico.',
      gravidade: 'informacao',
    });
  return av;
}

// ── Conta bancária (compartilhada com o financeiro) ──────────────────────────────────────────────────────────────

export interface ContaBancariaFornecedorEntrada {
  readonly banco: number | null;
  readonly tipoConta: (typeof TIPOS_CONTA_CREDOR)[number];
  readonly agencia: string | null;
  readonly digitoAgencia: string | null;
  readonly conta: string | null;
  readonly digitoConta: string | null;
  readonly tipoChavePix: TipoChavePix | null;
  readonly chavePix: string | null;
  readonly titularNome: string;
  readonly titularDocumento: string;
  readonly preferencial: boolean;
}

/** A chave Pix normalizada pelo tipo, ou nulo quando não confere. */
export function chavePixNormalizada(tipo: TipoChavePix, chave: string): string | null {
  const c = chave.trim();
  switch (tipo) {
    case 'cpf':
      return cpfValido(so(c)) && so(c).length === 11 ? so(c) : null;
    case 'cnpj':
      return cnpjValido(so(c)) && so(c).length === 14 ? so(c) : null;
    case 'email':
      return EMAIL.test(c) && c.length <= 77 ? c.toLowerCase() : null;
    case 'telefone': {
      const d = so(c);
      return d.length >= 12 && d.length <= 13 ? `+${d}` : null;
    }
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)
        ? c.toLowerCase()
        : null;
  }
}

export function conferirContaBancaria(e: ContaBancariaFornecedorEntrada): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  const temConta = e.banco !== null && !!so(e.conta);
  const temPix = !!e.chavePix?.trim();
  if (!temConta && !temPix)
    rs.push(recusa('conta-destino', 'Informe o banco e a conta, ou a chave Pix.', ['conta', 'chavePix']));
  if (temConta && !so(e.agencia))
    rs.push(recusa('conta-agencia', 'Informe a agência da conta.', ['agencia']));
  if (temPix !== (e.tipoChavePix !== null))
    rs.push(recusa('pix-tipo', 'A chave Pix e o tipo da chave andam juntos.', ['tipoChavePix']));
  else if (temPix && e.tipoChavePix && !chavePixNormalizada(e.tipoChavePix, e.chavePix!))
    rs.push(recusa('pix-chave', 'A chave Pix não confere com o tipo escolhido.', ['chavePix']));
  const doc = so(e.titularDocumento);
  if (!((doc.length === 11 && cpfValido(doc)) || (doc.length === 14 && cnpjValido(doc))))
    rs.push(recusa('titular-documento', 'O CPF ou CNPJ do titular não confere.', ['titularDocumento']));
  if (!e.titularNome.trim()) rs.push(recusa('titular-nome', 'Informe o titular.', ['titularNome']));
  return rs;
}

/** A conta mascarada para leitura (só os 4 últimos dígitos); a chave Pix mascarada no meio. */
export function mascararConta(conta: string | null, chavePix: string | null): string {
  if (conta) return `••••${so(conta).slice(-4)}`;
  if (chavePix) return chavePix.length <= 6 ? '••••' : `${chavePix.slice(0, 3)}••••${chavePix.slice(-2)}`;
  return '—';
}

// ── Avaliação periódica (fora do contrato) ───────────────────────────────────────────────────────────────────────

export const MESES_AVALIACAO_FORNECEDOR_CRITICO = 6;
export const MESES_AVALIACAO_FORNECEDOR_COMUM = 12;

export interface AvaliacaoPeriodicaEntrada {
  readonly avaliadoEm: string;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly notas: Readonly<Record<CriterioAvaliacao, number>>;
  readonly parecer: string | null;
}

export function conferirAvaliacaoPeriodica(e: AvaliacaoPeriodicaEntrada, hoje: string): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  for (const c of CRITERIOS_AVALIACAO_FORNECEDOR) {
    const v = e.notas[c.codigo];
    if (!Number.isInteger(v) || v < 1 || v > 5)
      rs.push(recusa('nota', `${c.rotulo}: a nota vai de 1 a 5.`, [`notas.${c.codigo}`]));
  }
  if (e.avaliadoEm > hoje)
    rs.push(recusa('avaliado-futuro', 'A avaliação não pode ter data futura.', ['avaliadoEm']));
  if (e.periodoInicio && e.periodoFim && e.periodoFim < e.periodoInicio)
    rs.push(recusa('periodo', 'O fim do período vem antes do início.', ['periodoFim']));
  if (e.periodoFim && e.periodoFim > e.avaliadoEm)
    rs.push(recusa('periodo-futuro', 'O período avaliado termina depois da avaliação.', ['periodoFim']));
  const r = avaliarFornecedor(e.notas);
  if (r.resultado === 'desqualificado' && !e.parecer?.trim())
    rs.push(recusa('parecer', 'A desqualificação pede o parecer.', ['parecer']));
  return rs;
}

/** A média das notas finais do período (as anteriores mais esta), com a conta impressa. */
export function mediaPeriodoAvaliacao(
  anteriores: readonly number[],
  atual: number,
): { media: number; conta: string } {
  const vs = [...anteriores, atual];
  const media = Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10_000) / 10_000;
  return {
    media,
    conta: `(${vs.map((v) => v.toFixed(2)).join(' + ')}) ÷ ${vs.length} = ${media.toFixed(2)}`,
  };
}

/** A próxima avaliação: o prazo do fornecedor em dias, ou 6 meses (crítico) / 12 meses depois da última. */
export function proximaAvaliacaoFornecedor(o: {
  readonly ultima: string;
  readonly diasValidade: number | null;
  readonly critico: boolean;
}): string {
  if (o.diasValidade && o.diasValidade > 0) {
    const [a, m, d] = o.ultima.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(a, m - 1, d + o.diasValidade)).toISOString().slice(0, 10);
  }
  return somarMeses(
    o.ultima,
    o.critico ? MESES_AVALIACAO_FORNECEDOR_CRITICO : MESES_AVALIACAO_FORNECEDOR_COMUM,
  );
}

// ── Ocorrência ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface OcorrenciaFornecedorEntrada {
  readonly tipo: TipoOcorrenciaFornecedor;
  readonly gravidade: GravidadeOcorrencia;
  readonly ocorridoEm: string;
  readonly quantidadeAfetada: number | null;
  readonly valorAfetado: number | null;
  readonly descricao: string;
}

export function conferirOcorrencia(e: OcorrenciaFornecedorEntrada, hoje: string): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (!e.descricao.trim()) rs.push(recusa('descricao', 'Descreva a ocorrência.', ['descricao']));
  if (e.ocorridoEm.slice(0, 10) > hoje)
    rs.push(recusa('ocorrido-futuro', 'A ocorrência não pode ter data futura.', ['ocorridoEm']));
  if (e.quantidadeAfetada !== null && !(e.quantidadeAfetada > 0))
    rs.push(recusa('quantidade', 'A quantidade afetada é maior que zero.', ['quantidadeAfetada']));
  if (e.valorAfetado !== null && !(e.valorAfetado >= 0))
    rs.push(recusa('valor', 'O valor afetado não pode ser negativo.', ['valorAfetado']));
  if (['divergencia_quantidade', 'avaria', 'produto_errado'].includes(e.tipo) && e.quantidadeAfetada === null)
    rs.push(
      recusa('quantidade-obrigatoria', 'Informe a quantidade afetada para este tipo.', ['quantidadeAfetada']),
    );
  return rs;
}

export const TRANSICOES_OCORRENCIA: Readonly<
  Record<SituacaoOcorrenciaFornecedor, readonly SituacaoOcorrenciaFornecedor[]>
> = {
  aberta: ['notificada', 'em_tratativa', 'resolvida', 'improcedente', 'cancelada'],
  notificada: ['em_tratativa', 'resolvida', 'improcedente', 'cancelada'],
  em_tratativa: ['resolvida', 'improcedente', 'cancelada'],
  resolvida: [],
  improcedente: [],
  cancelada: [],
};

/** O andamento da ocorrência: a transição permitida e o que cada passo pede. */
export function conferirAndamentoOcorrencia(o: {
  readonly de: SituacaoOcorrenciaFornecedor;
  readonly para: SituacaoOcorrenciaFornecedor;
  readonly tratativa: string | null;
  readonly email: string | null;
}): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (!TRANSICOES_OCORRENCIA[o.de].includes(o.para))
    return [
      recusa('transicao', `A ocorrência ${o.de.replace('_', ' ')} não passa a ${o.para.replace('_', ' ')}.`, [
        'situacao',
      ]),
    ];
  if (['resolvida', 'improcedente', 'cancelada'].includes(o.para) && !o.tratativa?.trim())
    rs.push(recusa('tratativa', 'Encerrar a ocorrência pede a tratativa (ou o motivo).', ['tratativa']));
  if (o.para === 'notificada' && (!o.email?.trim() || !EMAIL.test(o.email.trim())))
    rs.push(recusa('email-notificacao', 'Informe o e-mail em que o fornecedor foi notificado.', ['email']));
  return rs;
}

/** Quantas ocorrências seguem sem solução (aberta, notificada, em tratativa). */
export const ocorrenciaEmAberto = (s: SituacaoOcorrenciaFornecedor): boolean =>
  s === 'aberta' || s === 'notificada' || s === 'em_tratativa';
