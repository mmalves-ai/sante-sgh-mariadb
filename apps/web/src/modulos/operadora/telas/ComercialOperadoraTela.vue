<script setup lang="ts">
// Comercial da operadora (08-SGO L100, C2-095), atalho da tela de cobrança. Proposta de adesão com a ficha do cadastro
// da ANS (RN 195/2009): titular e dependentes numa tela só, a ficha conferida na hora pela mesma regra do domínio
// (problemasDaProposta) e os botões só das situações permitidas a partir da atual. Força de venda (corretora, vendedor,
// equipe), regra de comissão por faixa de parcelas, meta com faixas de prêmio e apuração, campanha de desconto e lote
// de comissão: só parcela paga entra, e o cancelamento ou a inadimplência dentro do prazo vira estorno no lote.
// Ler com operadora.comercial.ler; cadastrar e propor com operadora.comercial.registrar; regra e lote com
// operadora.comissao.apurar. Textos em i18n-comercial.ts (operadoraComercial).
import {
  MEDIDAS_META,
  type Proponente,
  problemasDaCampanha,
  problemasDaMeta,
  problemasDaMudancaCampanha,
  problemasDaMudancaComissao,
  problemasDaProposta,
  problemasDasParcelasDaRegra,
  proximasSituacoesProposta,
  SITUACOES_CAMPANHA,
  SITUACOES_COMISSAO,
  type SituacaoCampanha,
  type SituacaoComissao,
  type SituacaoProposta,
  type TipoProponente,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerTelaCobranca } from '../api-cobranca.js';
import {
  type ApuracaoMeta,
  apurarComissao,
  gravarCampanha,
  gravarCorretora,
  gravarEquipe,
  gravarMeta,
  gravarRegraComissao,
  gravarVendedor,
  incluirProposta,
  type Linha,
  lerApuracaoMeta,
  lerItensComissao,
  lerPainelComercial,
  lerProposta,
  mudarCampanha,
  mudarComissao,
  mudarProposta,
  type NovaCorretora,
  type PainelComercial,
  type PropostaLida,
} from '../api-comercial.js';

const { t, te } = useI18n();
const k = (s: string) => t(`operadoraComercial.${s}`);
/** Rótulo de um valor do vocabulário (situação, tipo); valor fora do vocabulário aparece como veio. */
const voc = (grupo: string, v: unknown) => {
  const c = `operadoraComercial.${grupo}.${String(v)}`;
  return te(c) ? t(c) : String(v ?? '—');
};

type Aba = 'propostas' | 'forca' | 'regras' | 'metas' | 'campanhas' | 'lotes';
const ABAS: Aba[] = ['propostas', 'forca', 'regras', 'metas', 'campanhas', 'lotes'];
const aba = ref<Aba>('propostas');
const podeRegistrar = computed(() => pode('operadora.comercial.registrar'));
const podeApurar = computed(() => pode('operadora.comissao.apurar'));
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const painel = ref<PainelComercial | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);

const hoje = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const moeda = (v: unknown) =>
  typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
const dataBr = (v: unknown) => (typeof v === 'string' && v ? v.split('-').reverse().join('/') : '—');
const numeroBr = (v: string): number | null => {
  const s = v.trim().replace(/\./g, '').replace(',', '.');
  return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
};
const texto = (v: string) => v.trim() || null;
const faltaTexto = (f: string[]) => t('operadoraComercial.falta', { itens: f.join(', ') });

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}
async function recarregar(ok?: string) {
  if (operadora.value === null) return;
  const op = operadora.value;
  painel.value = await tentar(() => lerPainelComercial(op));
  if (ok && painel.value) aviso.value = ok;
}
watch(operadora, () => void recarregar());

void tentar(async () => {
  const r = await lerTelaCobranca();
  operadoras.value = r.operadoras.map((o) => ({
    valor: o.id,
    rotulo: `${o.razaoSocial} (${o.registroAns})`,
  }));
  if (r.operadoras.length === 1) operadora.value = r.operadoras[0]!.id;
});

const opcoes = (ls: readonly Linha[] | undefined, f: (l: Linha) => string) => [
  { valor: null as number | null, rotulo: '—' },
  ...(ls ?? []).map((l) => ({ valor: l.id as number | null, rotulo: f(l) })),
];
const codNome = (l: Linha) => `${l['codigo']} — ${l['nome']}`;
const optCorretora = computed(() => opcoes(painel.value?.corretoras, codNome));
const optVendedor = computed(() => opcoes(painel.value?.vendedores, codNome));
const optEquipe = computed(() => opcoes(painel.value?.equipes, codNome));
const optPlano = computed(() => opcoes(painel.value?.planos, codNome));
const optContrato = computed(() => opcoes(painel.value?.contratos, (l) => String(l['numero'])));
const optParentesco = computed(() => opcoes(painel.value?.parentescos, (l) => String(l['descricao'])));
const optIncidencia = computed(() => opcoes(painel.value?.incidencias, (l) => String(l['descricao'])));
const optRegra = computed(() =>
  opcoes(painel.value?.regras as Linha[] | undefined, (l) => `${l['codigo']} — ${l['descricao']}`),
);
const vocab = (grupo: string, vs: readonly string[]) =>
  vs.map((v) => ({ valor: v as string | null, rotulo: voc(grupo, v) }));

// ---------------------------------------------------------------- propostas --------------------------------------
type LinhaProponente = {
  tipo: TipoProponente | null;
  nome: string;
  nascimento: string;
  sexo: string | null;
  cpf: string;
  cns: string;
  nomeMae: string;
  parentesco: number | null;
};
const novoProponente = (tipo: TipoProponente): LinhaProponente => ({
  tipo,
  nome: '',
  nascimento: '',
  sexo: null,
  cpf: '',
  cns: '',
  nomeMae: '',
  parentesco: null,
});
const tiposProponente = computed(() => vocab('tiposProponente', ['titular', 'dependente', 'agregado']));
const sexos = computed(() => vocab('sexos', ['M', 'F']));
const prop = ref({
  propostaEm: hoje,
  plano: null as number | null,
  contrato: null as number | null,
  vendedor: null as number | null,
  corretora: null as number | null,
  equipe: null as number | null,
  diaVencimento: '',
  observacao: '',
});
const proponentes = ref<LinhaProponente[]>([novoProponente('titular')]);
/** Cada dependente ou agregado fica com o titular mais próximo acima dele na lista. */
const proponentesMontados = computed<Proponente[]>(() => {
  let titular: number | null = null;
  return proponentes.value.map((p, i) => {
    const sequencia = i + 1;
    if (p.tipo === 'titular') titular = sequencia;
    return {
      sequencia,
      tipo: p.tipo ?? 'titular',
      titularSequencia: p.tipo === 'titular' ? null : titular,
      parentesco: p.tipo === 'titular' ? null : p.parentesco,
      nome: p.nome.trim(),
      nascimento: p.nascimento,
      sexo: p.sexo ?? '',
      cpf: p.cpf.replace(/\D/g, '') || null,
      cns: p.cns.replace(/\D/g, '') || null,
      nomeMae: texto(p.nomeMae),
    };
  });
});
const diaVenc = computed(() => (prop.value.diaVencimento.trim() ? Number(prop.value.diaVencimento) : null));
const problemasProposta = computed(() =>
  problemasDaProposta({
    propostaEm: prop.value.propostaEm,
    hoje,
    diaVencimento: diaVenc.value,
    proponentes: proponentesMontados.value,
  }),
);
/** O rascunho aceita a ficha incompleta; estes problemas impedem até o rascunho (a mesma lista do servidor). */
const BLOQUEIAM = [
  'proposta-futura',
  'dia-vencimento-invalido',
  'dependente-sem-titular',
  'cpf-invalido',
  'cpf-repetido',
];
const bloqueioProposta = computed(() => {
  const f = problemasProposta.value.filter((p) => BLOQUEIAM.includes(p.codigo)).map((p) => p.detalhe);
  if (prop.value.plano === null) f.unshift(k('faltas.plano'));
  if (!DATA.test(prop.value.propostaEm)) f.unshift(k('faltas.dataProposta'));
  return f;
});
const pendenciasEnvio = computed(() =>
  problemasProposta.value.filter((p) => !BLOQUEIAM.includes(p.codigo)).map((p) => p.detalhe),
);
async function salvarProposta() {
  if (operadora.value === null || prop.value.plano === null) return;
  const op = operadora.value;
  const plano = prop.value.plano;
  const r = await tentar(() =>
    incluirProposta(op, {
      propostaEm: prop.value.propostaEm,
      plano,
      contrato: prop.value.contrato,
      contratante: null,
      vendedor: prop.value.vendedor,
      corretora: prop.value.corretora,
      equipe: prop.value.equipe,
      diaVencimento: diaVenc.value,
      observacao: texto(prop.value.observacao),
      proponentes: proponentesMontados.value,
    }),
  );
  if (r) {
    proponentes.value = [novoProponente('titular')];
    prop.value = { ...prop.value, plano: null, contrato: null, diaVencimento: '', observacao: '' };
    await recarregar(t('operadoraComercial.proposta.gravada', { numero: String(r['numero'] ?? r.id) }));
    await abrirProposta(r.id);
  }
}
const proposta = ref<PropostaLida | null>(null);
const propMotivo = ref('');
const propContrato = ref<number | null>(null);
async function abrirProposta(id: number) {
  const msg = aviso.value;
  proposta.value = await tentar(() => lerProposta(id));
  if (msg && !erro.value) aviso.value = msg;
  propMotivo.value = '';
  propContrato.value = proposta.value?.contrato ?? null;
}
const proximas = computed(() => (proposta.value ? proximasSituacoesProposta(proposta.value.situacao) : []));
const exigeMotivo = (para: SituacaoProposta) =>
  ['recusada', 'cancelada', 'pendente_documento'].includes(para);
async function mudarSituacaoProposta(para: SituacaoProposta) {
  const p = proposta.value;
  if (!p) return;
  const r = await tentar(() =>
    mudarProposta(p.id, {
      versao: p.versao,
      para,
      motivo: texto(propMotivo.value),
      contrato: para === 'efetivada' ? propContrato.value : null,
    }),
  );
  if (r) {
    await recarregar(
      t('operadoraComercial.proposta.mudou', { numero: p.numero, situacao: voc('situacoesProposta', para) }),
    );
    await abrirProposta(p.id);
  }
}

// ---------------------------------------------------------------- força de venda ---------------------------------
const tiposCorretora = computed(() =>
  vocab('tiposCorretora', ['corretora', 'administradora', 'unidade_venda', 'venda_propria']),
);
const cor = ref({ codigo: '', nome: '', tipo: 'corretora' as string | null, cnpj: '', susep: '', email: '' });
const corPai = ref<number | null>(null);
const faltaCorretora = computed(() => {
  const f: string[] = [];
  if (!cor.value.codigo.trim()) f.push(k('faltas.codigo'));
  if (!cor.value.nome.trim()) f.push(k('faltas.nome'));
  if (cor.value.cnpj && !/^\d{14}$/.test(cor.value.cnpj.replace(/\D/g, ''))) f.push(k('faltas.cnpj'));
  if (cor.value.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cor.value.email)) f.push(k('faltas.email'));
  return f;
});
async function salvarCorretora() {
  if (operadora.value === null) return;
  const op = operadora.value;
  const r = await tentar(() =>
    gravarCorretora(op, {
      codigo: cor.value.codigo.trim(),
      nome: cor.value.nome.trim(),
      tipo: cor.value.tipo as NovaCorretora['tipo'],
      cnpj: cor.value.cnpj.replace(/\D/g, '') || null,
      corretoraPai: corPai.value,
      registroSusep: texto(cor.value.susep),
      email: texto(cor.value.email),
    }),
  );
  if (r) {
    cor.value = { codigo: '', nome: '', tipo: 'corretora', cnpj: '', susep: '', email: '' };
    await recarregar(k('forca.corretoraCadastrada'));
  }
}
const ven = ref({ codigo: '', nome: '', cpf: '', email: '' });
const venCorretora = ref<number | null>(null);
const faltaVendedor = computed(() => {
  const f: string[] = [];
  if (!ven.value.codigo.trim()) f.push(k('faltas.codigo'));
  if (!ven.value.nome.trim()) f.push(k('faltas.nome'));
  if (!/^\d{11}$/.test(ven.value.cpf.replace(/\D/g, ''))) f.push(k('faltas.cpf'));
  return f;
});
async function salvarVendedor() {
  if (operadora.value === null) return;
  const op = operadora.value;
  const r = await tentar(() =>
    gravarVendedor(op, {
      codigo: ven.value.codigo.trim(),
      nome: ven.value.nome.trim(),
      cpf: ven.value.cpf.replace(/\D/g, ''),
      corretora: venCorretora.value,
      email: texto(ven.value.email),
    }),
  );
  if (r) {
    ven.value = { codigo: '', nome: '', cpf: '', email: '' };
    await recarregar(k('forca.vendedorCadastrado'));
  }
}
const eq = ref({ codigo: '', nome: '', inicio: hoje });
const eqCorretora = ref<number | null>(null);
const eqChefe = ref<number | null>(null);
const eqMembros = ref<number[]>([]);
const eqNovoMembro = ref<number | null>(null);
watch(eqNovoMembro, (v) => {
  if (v !== null && !eqMembros.value.includes(v)) eqMembros.value.push(v);
  if (v !== null) eqNovoMembro.value = null;
});
const nomeVendedor = (id: number) =>
  String(painel.value?.vendedores.find((v) => v.id === id)?.['nome'] ?? id);
const faltaEquipe = computed(() => {
  const f: string[] = [];
  if (!eq.value.codigo.trim()) f.push(k('faltas.codigo'));
  if (!eq.value.nome.trim()) f.push(k('faltas.nome'));
  if (eqMembros.value.length && !DATA.test(eq.value.inicio)) f.push(k('faltas.inicioMembros'));
  return f;
});
async function salvarEquipe() {
  if (operadora.value === null) return;
  const op = operadora.value;
  const r = await tentar(() =>
    gravarEquipe(op, {
      codigo: eq.value.codigo.trim(),
      nome: eq.value.nome.trim(),
      corretora: eqCorretora.value,
      chefe: eqChefe.value,
      membros: eqMembros.value.map((vendedor) => ({ vendedor, inicio: eq.value.inicio })),
    }),
  );
  if (r) {
    eq.value = { codigo: '', nome: '', inicio: hoje };
    eqMembros.value = [];
    await recarregar(k('forca.equipeCadastrada'));
  }
}

// ---------------------------------------------------------------- regras de comissão -----------------------------
type RegraParcela = PainelComercial['regras'][number]['parcelas'][number];
const reg = ref({ codigo: '', descricao: '', inicio: hoje, fim: '' });
const regIncidencia = ref<number | null>(null);
const regAlvo = ref({
  corretora: null as number | null,
  equipe: null as number | null,
  vendedor: null as number | null,
  plano: null as number | null,
});
const regParcelas = ref<{ de: string; ate: string; percentual: string }[]>([
  { de: '1', ate: '', percentual: '' },
]);
const parcelasMontadas = computed(() =>
  regParcelas.value.map((p) => ({
    parcelaInicial: Number(p.de) || 0,
    parcelaFinal: p.ate.trim() ? Number(p.ate) : null,
    tipo: 'percentual' as const,
    percentual: numeroBr(p.percentual),
    valor: null,
    desconto: null,
    vigenciaInicio: reg.value.inicio,
  })),
);
const faltaRegra = computed(() => {
  const f: string[] = [];
  if (!reg.value.codigo.trim()) f.push(k('faltas.codigo'));
  if (!reg.value.descricao.trim()) f.push(k('faltas.descricao'));
  if (regIncidencia.value === null) f.push(k('faltas.incidencia'));
  if (!DATA.test(reg.value.inicio)) f.push(k('faltas.inicioVigencia'));
  if (!regParcelas.value.length) f.push(k('faltas.umaFaixa'));
  if (parcelasMontadas.value.some((p) => p.percentual === null)) f.push(k('faltas.percentualFaixa'));
  return [...f, ...problemasDasParcelasDaRegra(parcelasMontadas.value).map((p) => p.detalhe)];
});
async function salvarRegra() {
  if (operadora.value === null || regIncidencia.value === null) return;
  const op = operadora.value;
  const incidencia = regIncidencia.value;
  const r = await tentar(() =>
    gravarRegraComissao(op, {
      codigo: reg.value.codigo.trim(),
      descricao: reg.value.descricao.trim(),
      incidencia,
      vigenciaInicio: reg.value.inicio,
      vigenciaFim: reg.value.fim || null,
      ...regAlvo.value,
      parcelas: parcelasMontadas.value,
    }),
  );
  if (r) {
    reg.value = { codigo: '', descricao: '', inicio: hoje, fim: '' };
    regParcelas.value = [{ de: '1', ate: '', percentual: '' }];
    await recarregar(k('regra.cadastrada'));
  }
}
const faixaRegra = (p: RegraParcela) =>
  t('operadoraComercial.regra.faixa', {
    de: p.parcelaInicial,
    ate:
      p.parcelaFinal === null
        ? k('regra.emDiante')
        : t('operadoraComercial.regra.ate', { n: p.parcelaFinal }),
    valor: p.tipo === 'percentual' ? `${p.percentual}%` : moeda(p.valor),
  });

// ---------------------------------------------------------------- metas ------------------------------------------
const medidas = computed(() => vocab('medidas', MEDIDAS_META));
const meta = ref({ descricao: '', medida: 'vidas' as string | null, inicio: '', fim: '', valor: '' });
const metaAlvo = ref({
  corretora: null as number | null,
  equipe: null as number | null,
  vendedor: null as number | null,
});
const metaFaixas = ref<{ de: string; ate: string; premio: string }[]>([{ de: '100', ate: '', premio: '' }]);
const faixasMeta = computed(() =>
  metaFaixas.value.map((f) => ({
    de: numeroBr(f.de) ?? 0,
    ate: numeroBr(f.ate),
    percentualPremio: numeroBr(f.premio),
    valorPremio: null,
  })),
);
const faltaMeta = computed(() => {
  const f: string[] = [];
  if (!DATA.test(meta.value.inicio) || !DATA.test(meta.value.fim)) f.push(k('faltas.periodo'));
  return [
    ...f,
    ...problemasDaMeta({
      descricao: meta.value.descricao,
      inicio: meta.value.inicio,
      fim: meta.value.fim,
      valorMeta: numeroBr(meta.value.valor),
      faixas: faixasMeta.value,
    }).map((p) => p.detalhe),
  ];
});
async function salvarMeta() {
  if (operadora.value === null) return;
  const op = operadora.value;
  const r = await tentar(() =>
    gravarMeta(op, {
      descricao: meta.value.descricao.trim(),
      medida: meta.value.medida as (typeof MEDIDAS_META)[number],
      inicio: meta.value.inicio,
      fim: meta.value.fim,
      ...metaAlvo.value,
      valorMeta: numeroBr(meta.value.valor),
      faixas: faixasMeta.value,
    }),
  );
  if (r) {
    meta.value = { descricao: '', medida: 'vidas', inicio: '', fim: '', valor: '' };
    metaFaixas.value = [{ de: '100', ate: '', premio: '' }];
    await recarregar(k('meta.cadastrada'));
  }
}
const apuracoes = ref<Record<number, ApuracaoMeta>>({});
async function apurarMeta(id: number) {
  const r = await tentar(() => lerApuracaoMeta(id));
  if (r) apuracoes.value = { ...apuracoes.value, [id]: r };
}
const textoApuracao = (a: ApuracaoMeta) =>
  [
    t('operadoraComercial.meta.realizado', { n: a.realizado }),
    a.atingido === null ? null : t('operadoraComercial.meta.atingido', { n: a.atingido }),
    a.percentualPremio !== null
      ? t('operadoraComercial.meta.premioPct', { n: a.percentualPremio })
      : a.valorPremio !== null
        ? t('operadoraComercial.meta.premioValor', { valor: moeda(a.valorPremio) })
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

// ---------------------------------------------------------------- campanhas --------------------------------------
const camp = ref({ codigo: '', descricao: '', inicio: hoje, fim: '', condicoes: '' });
const campRegra = ref<number | null>(null);
const campDescontos = ref<{ parcela: string; percentual: string }[]>([{ parcela: '1', percentual: '' }]);
const campParticipante = ref({
  corretora: null as number | null,
  equipe: null as number | null,
  vendedor: null as number | null,
});
const descontosMontados = computed(() =>
  campDescontos.value.map((d) => ({
    parcela: Number(d.parcela) || 0,
    percentual: numeroBr(d.percentual),
    valor: null,
  })),
);
const faltaCampanha = computed(() =>
  problemasDaCampanha({
    codigo: camp.value.codigo,
    descricao: camp.value.descricao,
    inicio: camp.value.inicio,
    fim: camp.value.fim || null,
    descontos: descontosMontados.value,
  }).map((p) => p.detalhe),
);
async function salvarCampanha() {
  if (operadora.value === null) return;
  const op = operadora.value;
  const pa = campParticipante.value;
  const r = await tentar(() =>
    gravarCampanha(op, {
      codigo: camp.value.codigo.trim(),
      descricao: camp.value.descricao.trim(),
      inicio: camp.value.inicio,
      fim: camp.value.fim || null,
      regra: campRegra.value,
      condicoes: texto(camp.value.condicoes),
      descontos: descontosMontados.value,
      participantes: pa.corretora || pa.equipe || pa.vendedor ? [{ ...pa }] : [],
    }),
  );
  if (r) {
    camp.value = { codigo: '', descricao: '', inicio: hoje, fim: '', condicoes: '' };
    campDescontos.value = [{ parcela: '1', percentual: '' }];
    await recarregar(k('campanha.cadastrada'));
  }
}
const acoesCampanha = (c: Linha) =>
  SITUACOES_CAMPANHA.filter(
    (para) =>
      para !== c['situacao'] &&
      !problemasDaMudancaCampanha(c['situacao'] as SituacaoCampanha, para, Number(c['descontos']) || 0).some(
        (p) => p.codigo.includes('transicao'),
      ),
  );
async function mudarSituacaoCampanha(c: Linha, para: SituacaoCampanha) {
  const r = await tentar(() => mudarCampanha(c.id, { versao: Number(c['versao']), para }));
  if (r)
    await recarregar(
      t('operadoraComercial.campanha.mudou', {
        codigo: String(c['codigo']),
        situacao: voc('situacoesCampanha', para),
      }),
    );
}

// ---------------------------------------------------------------- lotes de comissão ------------------------------
const lote = ref({ descricao: '', inicio: '', fim: '', prazo: '365', irrf: '1,5', iss: '0' });
const loteRegra = ref<number | null>(null);
const loteAlvo = ref({
  corretora: null as number | null,
  equipe: null as number | null,
  vendedor: null as number | null,
});
const faltaLote = computed(() => {
  const f: string[] = [];
  if (loteRegra.value === null) f.push(k('faltas.regra'));
  if (!DATA.test(lote.value.inicio) || !DATA.test(lote.value.fim)) f.push(k('faltas.periodoPagamento'));
  else if (lote.value.fim < lote.value.inicio) f.push(k('faltas.fimDepois'));
  const prazo = Number(lote.value.prazo);
  if (!Number.isInteger(prazo) || prazo < 0 || prazo > 1095) f.push(k('faltas.prazo'));
  const irrf = numeroBr(lote.value.irrf);
  if (irrf === null || irrf < 0 || irrf > 30) f.push(k('faltas.irrf'));
  const iss = numeroBr(lote.value.iss);
  if (iss === null || iss < 0 || iss > 5) f.push(k('faltas.iss'));
  return f;
});
async function apurarLote() {
  if (operadora.value === null || loteRegra.value === null) return;
  const op = operadora.value;
  const regra = loteRegra.value;
  const r = await tentar(() =>
    apurarComissao(op, {
      descricao: texto(lote.value.descricao),
      regra,
      ...loteAlvo.value,
      pagamentoInicio: lote.value.inicio,
      pagamentoFim: lote.value.fim,
      prazoEstornoDias: Number(lote.value.prazo),
      aliquotaIrrf: numeroBr(lote.value.irrf) ?? 0,
      aliquotaIss: numeroBr(lote.value.iss) ?? 0,
    }),
  );
  if (r) {
    await recarregar(
      t('operadoraComercial.lote.apurado', {
        numero: String(r['numero'] ?? r.id),
        valor: moeda(r['liquido']),
      }),
    );
    await abrirLote(r.id);
  }
}
const loteAberto = ref<number | null>(null);
const itensLote = ref<Linha[]>([]);
const loteMotivo = ref('');
async function abrirLote(id: number) {
  const msg = aviso.value;
  loteAberto.value = id;
  loteMotivo.value = '';
  itensLote.value = (await tentar(() => lerItensComissao(id))) ?? [];
  if (msg && !erro.value) aviso.value = msg;
}
const acoesLote = (l: Linha) =>
  SITUACOES_COMISSAO.filter(
    (para) =>
      !problemasDaMudancaComissao(l['situacao'] as SituacaoComissao, para, 'motivo').some(
        (p) => p.codigo === 'comissao-transicao-invalida',
      ),
  );
const loteExigeMotivo = (l: Linha, para: SituacaoComissao) =>
  problemasDaMudancaComissao(l['situacao'] as SituacaoComissao, para, null).length > 0;
async function mudarSituacaoLote(l: Linha, para: SituacaoComissao) {
  const r = await tentar(() =>
    mudarComissao(l.id, { versao: Number(l['versao']), para, motivo: texto(loteMotivo.value) }),
  );
  if (r) {
    await recarregar(
      t('operadoraComercial.lote.mudou', {
        numero: String(l['numero']),
        situacao: voc('situacoesLote', para),
      }),
    );
    await abrirLote(l.id);
  }
}
const loteSelecionado = computed(() => painel.value?.lotes.find((l) => l.id === loteAberto.value) ?? null);
const tipoItem = (i: Linha) => {
  const r = voc('tiposItemLote', i['tipo']);
  return i['pendente'] ? t('operadoraComercial.lote.pendente', { tipo: r }) : r;
};
</script>

<template>
  <section class="comercial" aria-labelledby="comercial-titulo" data-testid="tela-comercial-operadora">
    <h1 id="comercial-titulo">{{ k('titulo') }}</h1>
    <p class="comercial__ajuda">{{ k('ajuda') }}</p>
    <RouterLink to="/operadora/cobranca" data-testid="link-cobranca">{{ k('voltar') }}</RouterLink>
    <SanteAlerta
      v-if="!podeRegistrar"
      :texto="k('somenteLeitura')"
      variante="info"
      data-testid="comercial-somente-leitura"
    />
    <SanteSelecao
      id="comercial-operadora"
      v-model="operadora"
      :rotulo="k('operadora')"
      :opcoes="operadoras"
      data-testid="comercial-operadora"
    />
    <nav class="comercial__linha" :aria-label="k('titulo')">
      <SanteBotao
        v-for="a in ABAS"
        :key="a"
        :rotulo="k(`abas.${a}`)"
        :variante="aba === a ? 'primario' : 'secundario'"
        :aria-pressed="aba === a"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      />
    </nav>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="comercial-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="comercial-aviso" />

    <p v-if="!painel" role="status">{{ k('escolha') }}</p>

    <!-- Propostas -->
    <div v-else-if="aba === 'propostas'" class="comercial__painel" data-testid="painel-propostas">
      <form
        v-if="podeRegistrar"
        class="comercial__cartao"
        data-testid="form-proposta"
        @submit.prevent="salvarProposta"
      >
        <h2>{{ k('proposta.nova') }}</h2>
        <div class="comercial__linha">
          <SanteCampoTexto
            id="prop-data"
            v-model="prop.propostaEm"
            :max-bytes="10"
            :rotulo="k('proposta.data')"
            data-testid="prop-data"
          />
          <SanteSelecao
            id="prop-plano"
            v-model="prop.plano"
            :rotulo="k('campos.plano')"
            :opcoes="optPlano"
            data-testid="prop-plano"
          />
          <SanteSelecao
            id="prop-contrato"
            v-model="prop.contrato"
            :rotulo="k('proposta.contrato')"
            :opcoes="optContrato"
            data-testid="prop-contrato"
          />
          <SanteCampoTexto
            id="prop-dia"
            v-model="prop.diaVencimento"
            :max-bytes="2"
            :rotulo="k('proposta.dia')"
            data-testid="prop-dia"
          />
        </div>
        <div class="comercial__linha">
          <SanteSelecao
            id="prop-corretora"
            v-model="prop.corretora"
            :rotulo="k('campos.corretora')"
            :opcoes="optCorretora"
            data-testid="prop-corretora"
          />
          <SanteSelecao
            id="prop-equipe"
            v-model="prop.equipe"
            :rotulo="k('campos.equipe')"
            :opcoes="optEquipe"
            data-testid="prop-equipe"
          />
          <SanteSelecao
            id="prop-vendedor"
            v-model="prop.vendedor"
            :rotulo="k('campos.vendedor')"
            :opcoes="optVendedor"
            data-testid="prop-vendedor"
          />
        </div>
        <h3>{{ k('proposta.proponentes') }}</h3>
        <div
          v-for="(p, i) in proponentes"
          :key="i"
          class="comercial__linha"
          :data-testid="`proponente-${i + 1}`"
        >
          <SanteSelecao
            :id="`pp-tipo-${i}`"
            v-model="p.tipo"
            :rotulo="k('campos.tipo')"
            :opcoes="tiposProponente"
            :data-testid="`pp-tipo-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`pp-nome-${i}`"
            v-model="p.nome"
            :max-bytes="150"
            :rotulo="k('campos.nome')"
            :data-testid="`pp-nome-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`pp-nasc-${i}`"
            v-model="p.nascimento"
            :max-bytes="10"
            :rotulo="k('proposta.nascimento')"
            :data-testid="`pp-nascimento-${i + 1}`"
          />
          <SanteSelecao
            :id="`pp-sexo-${i}`"
            v-model="p.sexo"
            :rotulo="k('proposta.sexo')"
            :opcoes="sexos"
            :data-testid="`pp-sexo-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`pp-cpf-${i}`"
            v-model="p.cpf"
            :max-bytes="14"
            :rotulo="k('campos.cpf')"
            :data-testid="`pp-cpf-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`pp-cns-${i}`"
            v-model="p.cns"
            :max-bytes="18"
            :rotulo="k('proposta.cns')"
            :data-testid="`pp-cns-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`pp-mae-${i}`"
            v-model="p.nomeMae"
            :max-bytes="150"
            :rotulo="k('proposta.mae')"
            :data-testid="`pp-mae-${i + 1}`"
          />
          <SanteSelecao
            v-if="p.tipo !== 'titular'"
            :id="`pp-par-${i}`"
            v-model="p.parentesco"
            :rotulo="k('proposta.parentesco')"
            :opcoes="optParentesco"
            :data-testid="`pp-parentesco-${i + 1}`"
          />
          <SanteBotao
            v-if="proponentes.length > 1"
            :rotulo="k('remover')"
            variante="secundario"
            :data-testid="`pp-remover-${i + 1}`"
            @click="proponentes.splice(i, 1)"
          />
        </div>
        <div class="comercial__linha">
          <SanteBotao
            :rotulo="k('proposta.incluirDependente')"
            variante="secundario"
            data-testid="pp-dependente"
            @click="proponentes.push(novoProponente('dependente'))"
          />
          <SanteBotao
            :rotulo="k('proposta.incluirTitular')"
            variante="secundario"
            data-testid="pp-titular"
            @click="proponentes.push(novoProponente('titular'))"
          />
        </div>
        <SanteCampoTexto
          id="prop-obs"
          v-model="prop.observacao"
          :max-bytes="2000"
          multilinha
          :rotulo="k('proposta.observacao')"
          data-testid="prop-obs"
        />
        <p v-if="bloqueioProposta.length" class="comercial__erro" data-testid="prop-falta">
          {{ bloqueioProposta.join(' ') }}
        </p>
        <p v-if="pendenciasEnvio.length" class="comercial__ajuda" data-testid="prop-pendencias">
          {{ t('operadoraComercial.proposta.pendencias', { itens: pendenciasEnvio.join(' ') }) }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('proposta.gravar')"
          :desabilitado="bloqueioProposta.length > 0"
          data-testid="prop-salvar"
        />
      </form>

      <div v-if="proposta" class="comercial__cartao" data-testid="proposta-aberta">
        <h2>
          {{
            t('operadoraComercial.proposta.cabecalho', {
              numero: proposta.numero,
              situacao: voc('situacoesProposta', proposta.situacao),
            })
          }}
        </h2>
        <p>
          {{
            t('operadoraComercial.proposta.resumo', {
              data: dataBr(proposta.propostaEm),
              n: proposta.proponentes.length,
            })
          }}
        </p>
        <ul>
          <li v-for="pp in proposta.proponentes" :key="pp.sequencia">
            {{ pp.sequencia }}. {{ voc('tiposProponente', pp.tipo) }} — {{ pp.nome }}
          </li>
        </ul>
        <p v-if="proposta.observacaoOperadora">
          {{ t('operadoraComercial.proposta.observacaoOperadora', { texto: proposta.observacaoOperadora }) }}
        </p>
        <template v-if="podeRegistrar && proximas.length">
          <div class="comercial__linha">
            <SanteCampoTexto
              id="prop-motivo"
              v-model="propMotivo"
              :max-bytes="500"
              :rotulo="k('proposta.motivo')"
              data-testid="prop-motivo"
            />
            <SanteSelecao
              v-if="proximas.includes('efetivada')"
              id="prop-contrato-efetivar"
              v-model="propContrato"
              :rotulo="k('proposta.contratoEfetivar')"
              :opcoes="optContrato"
              data-testid="prop-contrato-efetivar"
            />
          </div>
          <div class="comercial__linha">
            <SanteBotao
              v-for="para in proximas"
              :key="para"
              :rotulo="voc('acoesProposta', para)"
              :variante="para === 'cancelada' || para === 'recusada' ? 'secundario' : 'primario'"
              :desabilitado="exigeMotivo(para) && !propMotivo.trim()"
              :data-testid="`prop-para-${para}`"
              @click="mudarSituacaoProposta(para)"
            />
          </div>
        </template>
      </div>

      <table class="comercial__tabela" data-testid="tabela-propostas">
        <thead>
          <tr>
            <th>{{ k('proposta.numero') }}</th>
            <th>{{ k('proposta.data') }}</th>
            <th>{{ k('campos.plano') }}</th>
            <th>{{ k('campos.vendedor') }}</th>
            <th>{{ k('proposta.vidas') }}</th>
            <th>{{ k('campos.situacao') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in painel.propostas" :key="p.id" :data-testid="`proposta-${p.id}`">
            <td>{{ p['numero'] }}</td>
            <td>{{ dataBr(p['propostaEm']) }}</td>
            <td>{{ p['plano'] }}</td>
            <td>{{ p['vendedor'] ?? p['corretora'] ?? '—' }}</td>
            <td>{{ p['vidas'] }}</td>
            <td :data-testid="`proposta-situacao-${p.id}`">{{ voc('situacoesProposta', p['situacao']) }}</td>
            <td>
              <SanteBotao
                :rotulo="k('abrir')"
                variante="secundario"
                :data-testid="`proposta-abrir-${p.id}`"
                @click="abrirProposta(p.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Força de venda -->
    <div v-else-if="aba === 'forca'" class="comercial__painel" data-testid="painel-forca">
      <div v-if="podeRegistrar" class="comercial__linha comercial__linha--topo">
        <form class="comercial__cartao" data-testid="form-corretora" @submit.prevent="salvarCorretora">
          <h2>{{ k('forca.corretora') }}</h2>
          <SanteCampoTexto
            id="cor-codigo"
            v-model="cor.codigo"
            :max-bytes="30"
            :rotulo="k('campos.codigo')"
            data-testid="cor-codigo"
          />
          <SanteCampoTexto
            id="cor-nome"
            v-model="cor.nome"
            :max-bytes="150"
            :rotulo="k('campos.nome')"
            data-testid="cor-nome"
          />
          <SanteSelecao
            id="cor-tipo"
            v-model="cor.tipo"
            :rotulo="k('campos.tipo')"
            :opcoes="tiposCorretora"
            data-testid="cor-tipo"
          />
          <SanteCampoTexto
            id="cor-cnpj"
            v-model="cor.cnpj"
            :max-bytes="18"
            :rotulo="k('campos.cnpj')"
            data-testid="cor-cnpj"
          />
          <SanteCampoTexto
            id="cor-susep"
            v-model="cor.susep"
            :max-bytes="30"
            :rotulo="k('forca.susep')"
            data-testid="cor-susep"
          />
          <SanteCampoTexto
            id="cor-email"
            v-model="cor.email"
            :max-bytes="254"
            :rotulo="k('campos.email')"
            data-testid="cor-email"
          />
          <SanteSelecao
            id="cor-pai"
            v-model="corPai"
            :rotulo="k('forca.vinculada')"
            :opcoes="optCorretora"
            data-testid="cor-pai"
          />
          <p v-if="faltaCorretora.length" class="comercial__erro" data-testid="cor-falta">
            {{ faltaTexto(faltaCorretora) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="k('forca.cadastrarCorretora')"
            :desabilitado="faltaCorretora.length > 0"
            data-testid="cor-salvar"
          />
        </form>
        <form class="comercial__cartao" data-testid="form-vendedor" @submit.prevent="salvarVendedor">
          <h2>{{ k('forca.vendedor') }}</h2>
          <SanteCampoTexto
            id="ven-codigo"
            v-model="ven.codigo"
            :max-bytes="30"
            :rotulo="k('campos.codigo')"
            data-testid="ven-codigo"
          />
          <SanteCampoTexto
            id="ven-nome"
            v-model="ven.nome"
            :max-bytes="150"
            :rotulo="k('campos.nome')"
            data-testid="ven-nome"
          />
          <SanteCampoTexto
            id="ven-cpf"
            v-model="ven.cpf"
            :max-bytes="14"
            :rotulo="k('campos.cpf')"
            data-testid="ven-cpf"
          />
          <SanteCampoTexto
            id="ven-email"
            v-model="ven.email"
            :max-bytes="254"
            :rotulo="k('campos.email')"
            data-testid="ven-email"
          />
          <SanteSelecao
            id="ven-corretora"
            v-model="venCorretora"
            :rotulo="k('campos.corretora')"
            :opcoes="optCorretora"
            data-testid="ven-corretora"
          />
          <p v-if="faltaVendedor.length" class="comercial__erro" data-testid="ven-falta">
            {{ faltaTexto(faltaVendedor) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="k('forca.cadastrarVendedor')"
            :desabilitado="faltaVendedor.length > 0"
            data-testid="ven-salvar"
          />
        </form>
        <form class="comercial__cartao" data-testid="form-equipe" @submit.prevent="salvarEquipe">
          <h2>{{ k('forca.equipe') }}</h2>
          <SanteCampoTexto
            id="eq-codigo"
            v-model="eq.codigo"
            :max-bytes="30"
            :rotulo="k('campos.codigo')"
            data-testid="eq-codigo"
          />
          <SanteCampoTexto
            id="eq-nome"
            v-model="eq.nome"
            :max-bytes="150"
            :rotulo="k('campos.nome')"
            data-testid="eq-nome"
          />
          <SanteSelecao
            id="eq-corretora"
            v-model="eqCorretora"
            :rotulo="k('campos.corretora')"
            :opcoes="optCorretora"
            data-testid="eq-corretora"
          />
          <SanteSelecao
            id="eq-chefe"
            v-model="eqChefe"
            :rotulo="k('forca.chefe')"
            :opcoes="optVendedor"
            data-testid="eq-chefe"
          />
          <SanteSelecao
            id="eq-membro"
            v-model="eqNovoMembro"
            :rotulo="k('forca.incluirMembro')"
            :opcoes="optVendedor"
            data-testid="eq-membro"
          />
          <SanteCampoTexto
            id="eq-inicio"
            v-model="eq.inicio"
            :max-bytes="10"
            :rotulo="k('forca.membrosDesde')"
            data-testid="eq-inicio"
          />
          <ul data-testid="eq-membros">
            <li v-for="(m, i) in eqMembros" :key="m">
              {{ nomeVendedor(m) }}
              <SanteBotao :rotulo="k('forca.tirar')" variante="secundario" @click="eqMembros.splice(i, 1)" />
            </li>
          </ul>
          <p v-if="faltaEquipe.length" class="comercial__erro" data-testid="eq-falta">
            {{ faltaTexto(faltaEquipe) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="k('forca.cadastrarEquipe')"
            :desabilitado="faltaEquipe.length > 0"
            data-testid="eq-salvar"
          />
        </form>
      </div>
      <table class="comercial__tabela" data-testid="tabela-corretoras">
        <thead>
          <tr>
            <th>{{ k('forca.corretora') }}</th>
            <th>{{ k('campos.tipo') }}</th>
            <th>{{ k('forca.susepColuna') }}</th>
            <th>{{ k('campos.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in painel.corretoras" :key="c.id" :data-testid="`corretora-${c['codigo']}`">
            <td>{{ codNome(c) }}</td>
            <td>{{ voc('tiposCorretora', c['tipo']) }}</td>
            <td>{{ c['registroSusep'] ?? '—' }}</td>
            <td>{{ c['situacao'] }}</td>
          </tr>
        </tbody>
      </table>
      <table class="comercial__tabela" data-testid="tabela-vendedores">
        <thead>
          <tr>
            <th>{{ k('forca.vendedor') }}</th>
            <th>{{ k('forca.ativo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in painel.vendedores" :key="v.id" :data-testid="`vendedor-${v['codigo']}`">
            <td>{{ codNome(v) }}</td>
            <td>{{ v['ativo'] ? k('sim') : k('nao') }}</td>
          </tr>
        </tbody>
      </table>
      <table class="comercial__tabela" data-testid="tabela-equipes">
        <thead>
          <tr>
            <th>{{ k('forca.equipe') }}</th>
            <th>{{ k('forca.membros') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in painel.equipes" :key="e.id" :data-testid="`equipe-${e['codigo']}`">
            <td>{{ codNome(e) }}</td>
            <td>{{ e['membros'] }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Regras de comissão -->
    <div v-else-if="aba === 'regras'" class="comercial__painel" data-testid="painel-regras">
      <form
        v-if="podeApurar"
        class="comercial__cartao"
        data-testid="form-regra"
        @submit.prevent="salvarRegra"
      >
        <h2>{{ k('regra.nova') }}</h2>
        <div class="comercial__linha">
          <SanteCampoTexto
            id="reg-codigo"
            v-model="reg.codigo"
            :max-bytes="30"
            :rotulo="k('campos.codigo')"
            data-testid="reg-codigo"
          />
          <SanteCampoTexto
            id="reg-descricao"
            v-model="reg.descricao"
            :max-bytes="150"
            :rotulo="k('campos.descricao')"
            data-testid="reg-descricao"
          />
          <SanteSelecao
            id="reg-incidencia"
            v-model="regIncidencia"
            :rotulo="k('regra.incide')"
            :opcoes="optIncidencia"
            data-testid="reg-incidencia"
          />
          <SanteCampoTexto
            id="reg-inicio"
            v-model="reg.inicio"
            :max-bytes="10"
            :rotulo="k('regra.vigenciaDesde')"
            data-testid="reg-inicio"
          />
          <SanteCampoTexto
            id="reg-fim"
            v-model="reg.fim"
            :max-bytes="10"
            :rotulo="k('regra.vigenciaAte')"
            data-testid="reg-fim"
          />
        </div>
        <div class="comercial__linha">
          <SanteSelecao
            id="reg-corretora"
            v-model="regAlvo.corretora"
            :rotulo="k('regra.soCorretora')"
            :opcoes="optCorretora"
            data-testid="reg-corretora"
          />
          <SanteSelecao
            id="reg-equipe"
            v-model="regAlvo.equipe"
            :rotulo="k('regra.soEquipe')"
            :opcoes="optEquipe"
            data-testid="reg-equipe"
          />
          <SanteSelecao
            id="reg-vendedor"
            v-model="regAlvo.vendedor"
            :rotulo="k('regra.soVendedor')"
            :opcoes="optVendedor"
            data-testid="reg-vendedor"
          />
          <SanteSelecao
            id="reg-plano"
            v-model="regAlvo.plano"
            :rotulo="k('regra.soPlano')"
            :opcoes="optPlano"
            data-testid="reg-plano"
          />
        </div>
        <h3>{{ k('regra.faixas') }}</h3>
        <div v-for="(p, i) in regParcelas" :key="i" class="comercial__linha">
          <SanteCampoTexto
            :id="`reg-de-${i}`"
            v-model="p.de"
            :max-bytes="3"
            :rotulo="k('regra.daParcela')"
            :data-testid="`reg-de-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`reg-ate-${i}`"
            v-model="p.ate"
            :max-bytes="3"
            :rotulo="k('regra.ateParcela')"
            :data-testid="`reg-ate-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`reg-pct-${i}`"
            v-model="p.percentual"
            :max-bytes="8"
            :rotulo="k('regra.percentual')"
            :data-testid="`reg-percentual-${i + 1}`"
          />
          <SanteBotao
            v-if="regParcelas.length > 1"
            :rotulo="k('remover')"
            variante="secundario"
            @click="regParcelas.splice(i, 1)"
          />
        </div>
        <SanteBotao
          :rotulo="k('incluirFaixa')"
          variante="secundario"
          data-testid="reg-faixa"
          @click="regParcelas.push({ de: '', ate: '', percentual: '' })"
        />
        <p v-if="faltaRegra.length" class="comercial__erro" data-testid="reg-falta">
          {{ faltaRegra.join('; ') }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('regra.cadastrar')"
          :desabilitado="faltaRegra.length > 0"
          data-testid="reg-salvar"
        />
      </form>
      <table class="comercial__tabela" data-testid="tabela-regras">
        <thead>
          <tr>
            <th>{{ k('regra.regra') }}</th>
            <th>{{ k('regra.incidencia') }}</th>
            <th>{{ k('regra.vigencia') }}</th>
            <th>{{ k('regra.faixas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in painel.regras" :key="r.id" :data-testid="`regra-${r.codigo}`">
            <td>{{ r.codigo }} — {{ r.descricao }}</td>
            <td>{{ r['incidencia'] }}</td>
            <td>{{ dataBr(r['vigenciaInicio']) }} — {{ dataBr(r['vigenciaFim']) }}</td>
            <td>{{ r.parcelas.map(faixaRegra).join('; ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Metas -->
    <div v-else-if="aba === 'metas'" class="comercial__painel" data-testid="painel-metas">
      <form
        v-if="podeRegistrar"
        class="comercial__cartao"
        data-testid="form-meta"
        @submit.prevent="salvarMeta"
      >
        <h2>{{ k('meta.nova') }}</h2>
        <div class="comercial__linha">
          <SanteCampoTexto
            id="meta-descricao"
            v-model="meta.descricao"
            :max-bytes="150"
            :rotulo="k('campos.descricao')"
            data-testid="meta-descricao"
          />
          <SanteSelecao
            id="meta-medida"
            v-model="meta.medida"
            :rotulo="k('meta.medida')"
            :opcoes="medidas"
            data-testid="meta-medida"
          />
          <SanteCampoTexto
            id="meta-inicio"
            v-model="meta.inicio"
            :max-bytes="10"
            :rotulo="k('campos.inicio')"
            data-testid="meta-inicio"
          />
          <SanteCampoTexto
            id="meta-fim"
            v-model="meta.fim"
            :max-bytes="10"
            :rotulo="k('campos.fim')"
            data-testid="meta-fim"
          />
          <SanteCampoTexto
            id="meta-valor"
            v-model="meta.valor"
            :max-bytes="20"
            :rotulo="k('meta.meta')"
            data-testid="meta-valor"
          />
        </div>
        <div class="comercial__linha">
          <SanteSelecao
            id="meta-corretora"
            v-model="metaAlvo.corretora"
            :rotulo="k('campos.corretora')"
            :opcoes="optCorretora"
            data-testid="meta-corretora"
          />
          <SanteSelecao
            id="meta-equipe"
            v-model="metaAlvo.equipe"
            :rotulo="k('campos.equipe')"
            :opcoes="optEquipe"
            data-testid="meta-equipe"
          />
          <SanteSelecao
            id="meta-vendedor"
            v-model="metaAlvo.vendedor"
            :rotulo="k('campos.vendedor')"
            :opcoes="optVendedor"
            data-testid="meta-vendedor"
          />
        </div>
        <h3>{{ k('meta.faixas') }}</h3>
        <div v-for="(f, i) in metaFaixas" :key="i" class="comercial__linha">
          <SanteCampoTexto
            :id="`meta-de-${i}`"
            v-model="f.de"
            :max-bytes="8"
            :rotulo="k('meta.de')"
            :data-testid="`meta-de-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`meta-ate-${i}`"
            v-model="f.ate"
            :max-bytes="8"
            :rotulo="k('meta.ate')"
            :data-testid="`meta-ate-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`meta-premio-${i}`"
            v-model="f.premio"
            :max-bytes="8"
            :rotulo="k('meta.premio')"
            :data-testid="`meta-premio-${i + 1}`"
          />
          <SanteBotao
            v-if="metaFaixas.length > 1"
            :rotulo="k('remover')"
            variante="secundario"
            @click="metaFaixas.splice(i, 1)"
          />
        </div>
        <SanteBotao
          :rotulo="k('incluirFaixa')"
          variante="secundario"
          data-testid="meta-faixa"
          @click="metaFaixas.push({ de: '', ate: '', premio: '' })"
        />
        <p v-if="faltaMeta.length" class="comercial__erro" data-testid="meta-falta">
          {{ faltaMeta.join(' ') }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('meta.cadastrar')"
          :desabilitado="faltaMeta.length > 0"
          data-testid="meta-salvar"
        />
      </form>
      <table class="comercial__tabela" data-testid="tabela-metas">
        <thead>
          <tr>
            <th>{{ k('campos.descricao') }}</th>
            <th>{{ k('campos.periodo') }}</th>
            <th>{{ k('meta.meta') }}</th>
            <th>{{ k('meta.apuracao') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in painel.metas" :key="m.id" :data-testid="`meta-${m.id}`">
            <td>{{ m['descricao'] }} ({{ voc('medidas', m['medida']) }})</td>
            <td>{{ dataBr(m['inicio']) }} — {{ dataBr(m['fim']) }}</td>
            <td>{{ m['valorMeta'] ?? '—' }}</td>
            <td :data-testid="`meta-apuracao-${m.id}`">
              {{ apuracoes[m.id] ? textoApuracao(apuracoes[m.id]!) : '' }}
            </td>
            <td>
              <SanteBotao
                :rotulo="k('meta.apurar')"
                variante="secundario"
                :data-testid="`meta-apurar-${m.id}`"
                @click="apurarMeta(m.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Campanhas -->
    <div v-else-if="aba === 'campanhas'" class="comercial__painel" data-testid="painel-campanhas">
      <form
        v-if="podeRegistrar"
        class="comercial__cartao"
        data-testid="form-campanha"
        @submit.prevent="salvarCampanha"
      >
        <h2>{{ k('campanha.nova') }}</h2>
        <div class="comercial__linha">
          <SanteCampoTexto
            id="camp-codigo"
            v-model="camp.codigo"
            :max-bytes="30"
            :rotulo="k('campos.codigo')"
            data-testid="camp-codigo"
          />
          <SanteCampoTexto
            id="camp-descricao"
            v-model="camp.descricao"
            :max-bytes="250"
            :rotulo="k('campos.descricao')"
            data-testid="camp-descricao"
          />
          <SanteCampoTexto
            id="camp-inicio"
            v-model="camp.inicio"
            :max-bytes="10"
            :rotulo="k('campanha.vendaDesde')"
            data-testid="camp-inicio"
          />
          <SanteCampoTexto
            id="camp-fim"
            v-model="camp.fim"
            :max-bytes="10"
            :rotulo="k('campanha.vendaAte')"
            data-testid="camp-fim"
          />
          <SanteSelecao
            id="camp-regra"
            v-model="campRegra"
            :rotulo="k('campanha.regra')"
            :opcoes="optRegra"
            data-testid="camp-regra"
          />
        </div>
        <h3>{{ k('campanha.descontoParcela') }}</h3>
        <div v-for="(d, i) in campDescontos" :key="i" class="comercial__linha">
          <SanteCampoTexto
            :id="`camp-parcela-${i}`"
            v-model="d.parcela"
            :max-bytes="3"
            :rotulo="k('campanha.parcela')"
            :data-testid="`camp-parcela-${i + 1}`"
          />
          <SanteCampoTexto
            :id="`camp-pct-${i}`"
            v-model="d.percentual"
            :max-bytes="8"
            :rotulo="k('campanha.desconto')"
            :data-testid="`camp-percentual-${i + 1}`"
          />
          <SanteBotao
            v-if="campDescontos.length > 1"
            :rotulo="k('remover')"
            variante="secundario"
            @click="campDescontos.splice(i, 1)"
          />
        </div>
        <SanteBotao
          :rotulo="k('campanha.incluirParcela')"
          variante="secundario"
          data-testid="camp-desconto"
          @click="campDescontos.push({ parcela: '', percentual: '' })"
        />
        <div class="comercial__linha">
          <SanteSelecao
            id="camp-p-corretora"
            v-model="campParticipante.corretora"
            :rotulo="k('campanha.participaCorretora')"
            :opcoes="optCorretora"
            data-testid="camp-corretora"
          />
          <SanteSelecao
            id="camp-p-equipe"
            v-model="campParticipante.equipe"
            :rotulo="k('campanha.participaEquipe')"
            :opcoes="optEquipe"
            data-testid="camp-equipe"
          />
          <SanteSelecao
            id="camp-p-vendedor"
            v-model="campParticipante.vendedor"
            :rotulo="k('campanha.participaVendedor')"
            :opcoes="optVendedor"
            data-testid="camp-vendedor"
          />
        </div>
        <SanteCampoTexto
          id="camp-condicoes"
          v-model="camp.condicoes"
          :max-bytes="4000"
          multilinha
          :rotulo="k('campanha.condicoes')"
          data-testid="camp-condicoes"
        />
        <p v-if="faltaCampanha.length" class="comercial__erro" data-testid="camp-falta">
          {{ faltaCampanha.join(' ') }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('campanha.cadastrar')"
          :desabilitado="faltaCampanha.length > 0"
          data-testid="camp-salvar"
        />
      </form>
      <table class="comercial__tabela" data-testid="tabela-campanhas">
        <thead>
          <tr>
            <th>{{ k('campanha.campanha') }}</th>
            <th>{{ k('campos.periodo') }}</th>
            <th>{{ k('campanha.descontos') }}</th>
            <th>{{ k('campos.situacao') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in painel.campanhas" :key="c.id" :data-testid="`campanha-${c['codigo']}`">
            <td>{{ c['codigo'] }} — {{ c['descricao'] }}</td>
            <td>{{ dataBr(c['inicio']) }} — {{ dataBr(c['fim']) }}</td>
            <td>{{ c['descontos'] }}</td>
            <td :data-testid="`campanha-situacao-${c['codigo']}`">
              {{ voc('situacoesCampanha', c['situacao']) }}
            </td>
            <td>
              <template v-if="podeRegistrar">
                <SanteBotao
                  v-for="para in acoesCampanha(c)"
                  :key="para"
                  :rotulo="voc('acoesCampanha', para)"
                  variante="secundario"
                  :data-testid="`campanha-${c['codigo']}-${para}`"
                  @click="mudarSituacaoCampanha(c, para)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Lotes de comissão -->
    <div v-else class="comercial__painel" data-testid="painel-lotes">
      <form v-if="podeApurar" class="comercial__cartao" data-testid="form-lote" @submit.prevent="apurarLote">
        <h2>{{ k('lote.apurarTitulo') }}</h2>
        <p class="comercial__ajuda">{{ k('lote.ajuda') }}</p>
        <div class="comercial__linha">
          <SanteCampoTexto
            id="lote-descricao"
            v-model="lote.descricao"
            :max-bytes="150"
            :rotulo="k('campos.descricao')"
            data-testid="lote-descricao"
          />
          <SanteSelecao
            id="lote-regra"
            v-model="loteRegra"
            :rotulo="k('lote.regra')"
            :opcoes="optRegra"
            data-testid="lote-regra"
          />
          <SanteCampoTexto
            id="lote-inicio"
            v-model="lote.inicio"
            :max-bytes="10"
            :rotulo="k('lote.pagasDesde')"
            data-testid="lote-inicio"
          />
          <SanteCampoTexto
            id="lote-fim"
            v-model="lote.fim"
            :max-bytes="10"
            :rotulo="k('lote.pagasAte')"
            data-testid="lote-fim"
          />
        </div>
        <div class="comercial__linha">
          <SanteSelecao
            id="lote-corretora"
            v-model="loteAlvo.corretora"
            :rotulo="k('campos.corretora')"
            :opcoes="optCorretora"
            data-testid="lote-corretora"
          />
          <SanteSelecao
            id="lote-equipe"
            v-model="loteAlvo.equipe"
            :rotulo="k('campos.equipe')"
            :opcoes="optEquipe"
            data-testid="lote-equipe"
          />
          <SanteSelecao
            id="lote-vendedor"
            v-model="loteAlvo.vendedor"
            :rotulo="k('campos.vendedor')"
            :opcoes="optVendedor"
            data-testid="lote-vendedor"
          />
          <SanteCampoTexto
            id="lote-prazo"
            v-model="lote.prazo"
            :max-bytes="4"
            :rotulo="k('lote.prazo')"
            data-testid="lote-prazo"
          />
          <SanteCampoTexto
            id="lote-irrf"
            v-model="lote.irrf"
            :max-bytes="6"
            :rotulo="k('lote.irrf')"
            data-testid="lote-irrf"
          />
          <SanteCampoTexto
            id="lote-iss"
            v-model="lote.iss"
            :max-bytes="6"
            :rotulo="k('lote.iss')"
            data-testid="lote-iss"
          />
        </div>
        <p v-if="faltaLote.length" class="comercial__erro" data-testid="lote-falta">
          {{ faltaTexto(faltaLote) }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('lote.apurar')"
          :desabilitado="faltaLote.length > 0"
          data-testid="lote-apurar"
        />
      </form>
      <table class="comercial__tabela" data-testid="tabela-lotes">
        <thead>
          <tr>
            <th>{{ k('lote.lote') }}</th>
            <th>{{ k('campos.periodo') }}</th>
            <th>{{ k('lote.bruto') }}</th>
            <th>{{ k('lote.estorno') }}</th>
            <th>{{ k('lote.irrf') }}</th>
            <th>{{ k('lote.iss') }}</th>
            <th>{{ k('lote.liquido') }}</th>
            <th>{{ k('campos.situacao') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in painel.lotes" :key="l.id" :data-testid="`lote-${l.id}`">
            <td>{{ l['numero'] }} {{ l['corretora'] ?? l['vendedor'] ?? '' }}</td>
            <td>{{ dataBr(l['inicio']) }} — {{ dataBr(l['fim']) }}</td>
            <td>{{ moeda(l['bruto']) }}</td>
            <td>{{ moeda(l['estorno']) }}</td>
            <td>{{ moeda(l['irrf']) }}</td>
            <td>{{ moeda(l['iss']) }}</td>
            <td :data-testid="`lote-liquido-${l.id}`">{{ moeda(l['liquido']) }}</td>
            <td :data-testid="`lote-situacao-${l.id}`">{{ voc('situacoesLote', l['situacao']) }}</td>
            <td>
              <SanteBotao
                :rotulo="k('abrir')"
                variante="secundario"
                :data-testid="`lote-abrir-${l.id}`"
                @click="abrirLote(l.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loteSelecionado" class="comercial__cartao" data-testid="lote-aberto">
        <h2>
          {{
            t('operadoraComercial.lote.cabecalho', {
              numero: String(loteSelecionado['numero']),
              situacao: voc('situacoesLote', loteSelecionado['situacao']),
            })
          }}
        </h2>
        <table class="comercial__tabela" data-testid="tabela-itens-lote">
          <thead>
            <tr>
              <th>{{ k('lote.lancamento') }}</th>
              <th>{{ k('lote.contrato') }}</th>
              <th>{{ k('lote.parcela') }}</th>
              <th>{{ k('lote.competencia') }}</th>
              <th>{{ k('lote.base') }}</th>
              <th>%</th>
              <th>{{ k('lote.comissao') }}</th>
              <th>{{ k('lote.observacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itensLote" :key="i.id" :data-testid="`item-lote-${i['sequencia']}`">
              <td>{{ tipoItem(i) }}</td>
              <td>{{ i['contrato'] ?? '—' }}</td>
              <td>{{ i['parcela'] ?? '—' }}</td>
              <td>{{ i['competencia'] ?? '—' }}</td>
              <td>{{ moeda(i['base']) }}</td>
              <td>{{ i['percentual'] ?? '—' }}</td>
              <td>{{ moeda(i['valor']) }}</td>
              <td>{{ i['observacao'] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="podeApurar && acoesLote(loteSelecionado).length">
          <SanteCampoTexto
            id="lote-motivo"
            v-model="loteMotivo"
            :max-bytes="150"
            :rotulo="k('lote.motivo')"
            data-testid="lote-motivo"
          />
          <div class="comercial__linha">
            <SanteBotao
              v-for="para in acoesLote(loteSelecionado)"
              :key="para"
              :rotulo="voc('acoesLote', para)"
              :variante="para === 'cancelada' ? 'secundario' : 'primario'"
              :desabilitado="loteExigeMotivo(loteSelecionado, para) && !loteMotivo.trim()"
              :data-testid="`lote-para-${para}`"
              @click="mudarSituacaoLote(loteSelecionado, para)"
            />
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.comercial,
.comercial__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.comercial__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.comercial__linha--topo {
  align-items: flex-start;
}
.comercial__ajuda {
  color: var(--sgh-texto-secundario);
}
.comercial__erro {
  color: var(--sgh-alerta);
}
.comercial__cartao {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.comercial__tabela {
  width: 100%;
  border-collapse: collapse;
}
.comercial__tabela th,
.comercial__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
}
</style>
