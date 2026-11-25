// Laudos específicos da APAC e sessões do período (F7, 06-SUS linha 56). Regras puras: qual laudo complementar o
// procedimento da tabela unificada exige (oncologia, terapia renal, saúde auditiva, medicamento especializado,
// odontologia) e a conferência de cada complemento e de cada sessão antes da gravação. A família sai do grupo e do
// subgrupo do código SIGTAP (os mesmos critérios do manual do SIA para o laudo de APAC):
//   - 0304 tratamento em oncologia (030401 radioterapia; o resto quimioterapia);
//   - 0305 tratamento em nefrologia;
//   - 021107 diagnóstico em otorrinolaringologia e fonoaudiologia, 070103 órteses e próteses auditivas;
//   - 06 medicamentos do componente especializado;
//   - 0307 tratamento odontológico e 070107 próteses odontológicas.
// A sessão (diálise, radioterapia, quimioterapia) é registrada só na APAC autorizada, dentro da validade e não
// depois do encerramento; a modalidade da diálise vale só no procedimento de terapia renal e os kits só na diálise
// peritoneal.

export type FamiliaLaudoApac =
  | 'oncologia_radioterapia'
  | 'oncologia_quimioterapia'
  | 'nefrologia'
  | 'saude_auditiva'
  | 'medicamento'
  | 'odontologia'
  | 'outro';

/** Os laudos complementares gravados por esta família de regras (a terapia renal fica em apac.ts). */
export type LaudoEspecificoApac = 'oncologia' | 'auditiva' | 'medicamento' | 'odontologia';
export const LAUDOS_ESPECIFICOS_APAC: readonly LaudoEspecificoApac[] = [
  'oncologia',
  'auditiva',
  'medicamento',
  'odontologia',
];

export interface ProblemaApac {
  readonly campo: string;
  readonly mensagem: string;
}

const codigo = (c: string) => c.replace(/\D/g, '');

/** A família do laudo pelo código SIGTAP (10 dígitos, com ou sem pontuação). */
export function familiaLaudoDoProcedimento(codigoSigtap: string): FamiliaLaudoApac {
  const c = codigo(codigoSigtap);
  if (c.startsWith('030401')) return 'oncologia_radioterapia';
  if (c.startsWith('0304')) return 'oncologia_quimioterapia';
  if (c.startsWith('0305')) return 'nefrologia';
  if (c.startsWith('021107') || c.startsWith('070103')) return 'saude_auditiva';
  if (c.startsWith('06')) return 'medicamento';
  if (c.startsWith('0307') || c.startsWith('070107')) return 'odontologia';
  return 'outro';
}

/** O laudo complementar que a família exige (a terapia renal tem o seu próprio; "outro" não exige). */
export function laudoEspecificoDaFamilia(f: FamiliaLaudoApac): LaudoEspecificoApac | 'nefrologia' | null {
  switch (f) {
    case 'oncologia_radioterapia':
    case 'oncologia_quimioterapia':
      return 'oncologia';
    case 'nefrologia':
      return 'nefrologia';
    case 'saude_auditiva':
      return 'auditiva';
    case 'medicamento':
      return 'medicamento';
    case 'odontologia':
      return 'odontologia';
    default:
      return null;
  }
}

/** A família gravada no tipo do laudo quando o complemento entra (oncologia separa radio e quimio pelo tratamento). */
export function familiaDoLaudoEspecifico(
  l: LaudoEspecificoApac,
  tipoTratamento?: 'quimioterapia' | 'radioterapia',
): FamiliaLaudoApac {
  if (l === 'oncologia')
    return tipoTratamento === 'radioterapia' ? 'oncologia_radioterapia' : 'oncologia_quimioterapia';
  return l === 'auditiva' ? 'saude_auditiva' : l;
}

const CID = /^[A-Z][0-9]{2}[0-9A-Z]{0,3}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const cidValido = (c: string | null | undefined) => !c || CID.test(c.replace('.', '').toUpperCase());
const diaValido = (d: string | null | undefined) =>
  !d || (DIA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));

export interface LaudoOncologiaApac {
  readonly tipoTratamento: 'quimioterapia' | 'radioterapia';
  readonly localizacaoPrimaria: number | null;
  readonly topografiaCid: number | null;
  readonly estadiamentoTnm: string | null;
  readonly grauHistopatologico: string | null;
  readonly dataDiagnostico: string | null;
  readonly dataIdentificacaoPatologica: string | null;
  readonly linfonodosInvadidos: boolean | null;
  readonly metastase: boolean;
  readonly metastaseLocal: number | null;
  readonly finalidade: number | null;
  readonly esquema: number | null;
  readonly areaIrradiada: number | null;
  readonly camposInsercao: number | null;
  readonly dataInicioTratamento: string | null;
  readonly continuidadeTratamento: boolean;
  readonly tratamentoAnterior: boolean;
  readonly tipoTratamentoAnterior: number | null;
  readonly inicioTratamentoAnterior: string | null;
  readonly fimTratamentoAnterior: string | null;
  readonly observacao: string | null;
}

export interface LaudoAuditivaApac {
  readonly cidCausaBasica: string | null;
  readonly cidCausaAssociada: string | null;
  readonly justificativa: number | null;
  readonly dificuldadeAuditiva: boolean;
  readonly ouvidoDireito: boolean;
  readonly ouvidoEsquerdo: boolean;
  readonly evolucao: 'flutuante' | 'estavel' | 'progressiva' | null;
  readonly zumbido: boolean;
  readonly tontura: boolean;
  /** As causas marcadas (a lista fechada de CAUSAS_AUDITIVAS). */
  readonly causas: readonly CausaAuditiva[];
  readonly outrasCausas: string | null;
  readonly examesRealizados: string | null;
  readonly aparelhoIndicado: string | null;
  readonly acompanhamento: string | null;
}

export const CAUSAS_AUDITIVAS = [
  'causa_desconhecida',
  'causa_genetica',
  'surdez_subita',
  'malformacao_congenita',
  'presbiacusia',
  'otite_media_cronica',
  'pos_operatorio',
  'trauma_cranioencefalico',
  'idiopatica',
  'uso_ototoxicos',
  'fratura_osso_temporal',
  'anoxia',
  'baixo_peso',
  'trabalho_parto_prolongado',
  'prematuridade',
  'hiperbilirrubinemia',
  'meningite',
  'sarampo',
  'toxoplasmose',
  'caxumba',
  'rubeola_congenita',
] as const;
export type CausaAuditiva = (typeof CAUSAS_AUDITIVAS)[number];

export interface LaudoMedicamentoApac {
  /** O código SIGTAP do medicamento (grupo 06). */
  readonly medicamento: string;
  readonly cidPrincipal: string | null;
  readonly cidSecundario: string | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly dosePrescrita: string | null;
  readonly quantidades: readonly [number | null, number | null, number | null];
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
}

export interface LaudoOdontologiaApac {
  readonly anomaliaCraniofacial: boolean;
  readonly descricaoAnomalia: string | null;
  /** Marcas de oclusão, aparelho, dentes e prótese (a lista fechada de MARCAS_ODONTOLOGIA). */
  readonly marcas: readonly MarcaOdontologia[];
  readonly justificativaTrocaAparelho: string | null;
  readonly especificacaoDentes: string | null;
  readonly quantidadeImplantes: number | null;
  readonly condicaoBucal: string | null;
  readonly tratamentoProposto: string | null;
}

export const MARCAS_ODONTOLOGIA = [
  'mordida_cruzada_total',
  'mordida_cruzada_anterior',
  'mordida_cruzada_unilateral',
  'mordida_cruzada_bilateral',
  'desarmonia_maxilo_mandibular',
  'instalacao_aparelho_fixo',
  'instalacao_aparelho_movel',
  'manutencao_aparelho',
  'troca_aparelho',
  'dente_incluso',
  'dente_impactado',
  'remocao_cirurgica',
  'com_osteotomia',
  'desdentado_total',
  'desdentado_parcial',
  'implante_metalico',
] as const;
export type MarcaOdontologia = (typeof MARCAS_ODONTOLOGIA)[number];

export type ComplementoApac =
  | { readonly laudo: 'oncologia'; readonly dados: LaudoOncologiaApac }
  | { readonly laudo: 'auditiva'; readonly dados: LaudoAuditivaApac }
  | { readonly laudo: 'medicamento'; readonly dados: LaudoMedicamentoApac }
  | { readonly laudo: 'odontologia'; readonly dados: LaudoOdontologiaApac };

/** O estado da APAC que a conferência precisa (lido da autorização). */
export interface ApacParaComplemento {
  readonly situacao: 'solicitada' | 'autorizada' | 'negada' | 'encerrada' | 'cancelada';
  readonly procedimento: string;
  readonly dataSolicitacao: string;
}

/** O complemento só muda enquanto a APAC está solicitada ou autorizada; antes do pedido, nunca no futuro. */
export function problemasDoComplemento(
  a: ApacParaComplemento,
  c: ComplementoApac,
  hoje: string,
): ProblemaApac[] {
  const p: ProblemaApac[] = [];
  if (a.situacao !== 'solicitada' && a.situacao !== 'autorizada')
    p.push({
      campo: 'situacao',
      mensagem: 'O laudo complementar só muda na APAC solicitada ou autorizada.',
    });
  const exigido = laudoEspecificoDaFamilia(familiaLaudoDoProcedimento(a.procedimento));
  if (exigido !== null && exigido !== c.laudo)
    p.push({
      campo: 'laudo',
      mensagem: `O procedimento ${a.procedimento} pede o laudo de ${exigido}, não o de ${c.laudo}.`,
    });
  const futuro = (campo: string, d: string | null) => {
    if (!diaValido(d)) p.push({ campo, mensagem: 'Data inválida (AAAA-MM-DD).' });
    else if (d && d > hoje) p.push({ campo, mensagem: 'A data não pode ser futura.' });
  };
  switch (c.laudo) {
    case 'oncologia': {
      const o = c.dados;
      futuro('dataDiagnostico', o.dataDiagnostico);
      futuro('dataIdentificacaoPatologica', o.dataIdentificacaoPatologica);
      futuro('inicioTratamentoAnterior', o.inicioTratamentoAnterior);
      futuro('fimTratamentoAnterior', o.fimTratamentoAnterior);
      if (!diaValido(o.dataInicioTratamento))
        p.push({ campo: 'dataInicioTratamento', mensagem: 'Data inválida (AAAA-MM-DD).' });
      if (o.dataDiagnostico && o.dataInicioTratamento && o.dataInicioTratamento < o.dataDiagnostico)
        p.push({
          campo: 'dataInicioTratamento',
          mensagem: 'O tratamento não começa antes do diagnóstico.',
        });
      if (o.estadiamentoTnm && !/^[0-9A-Za-z()+/ -]{1,20}$/.test(o.estadiamentoTnm))
        p.push({ campo: 'estadiamentoTnm', mensagem: 'Estadiamento TNM com até 20 letras e números.' });
      if (!o.metastase && o.metastaseLocal !== null)
        p.push({ campo: 'metastaseLocal', mensagem: 'Local da metástase só com metástase marcada.' });
      if (o.tipoTratamento === 'radioterapia') {
        if (o.areaIrradiada === null)
          p.push({ campo: 'areaIrradiada', mensagem: 'A radioterapia pede a área irradiada.' });
        if (o.camposInsercao === null || o.camposInsercao < 1)
          p.push({ campo: 'camposInsercao', mensagem: 'A radioterapia pede os campos ou inserções.' });
      } else if (o.esquema === null)
        p.push({ campo: 'esquema', mensagem: 'A quimioterapia pede o esquema.' });
      if (o.finalidade === null)
        p.push({ campo: 'finalidade', mensagem: 'Informe a finalidade do tratamento.' });
      if (!o.tratamentoAnterior) {
        if (o.tipoTratamentoAnterior !== null || o.inicioTratamentoAnterior || o.fimTratamentoAnterior)
          p.push({
            campo: 'tratamentoAnterior',
            mensagem: 'Tratamento anterior detalhado sem a marca de tratamento anterior.',
          });
      } else if (o.tipoTratamentoAnterior === null)
        p.push({ campo: 'tipoTratamentoAnterior', mensagem: 'Informe o tratamento anterior.' });
      if (
        o.inicioTratamentoAnterior &&
        o.fimTratamentoAnterior &&
        o.fimTratamentoAnterior < o.inicioTratamentoAnterior
      )
        p.push({ campo: 'fimTratamentoAnterior', mensagem: 'O fim vem depois do início.' });
      break;
    }
    case 'auditiva': {
      const o = c.dados;
      if (!cidValido(o.cidCausaBasica)) p.push({ campo: 'cidCausaBasica', mensagem: 'CID-10 inválido.' });
      if (!cidValido(o.cidCausaAssociada))
        p.push({ campo: 'cidCausaAssociada', mensagem: 'CID-10 inválido.' });
      if (o.dificuldadeAuditiva && !o.ouvidoDireito && !o.ouvidoEsquerdo)
        p.push({ campo: 'ouvido', mensagem: 'Marque o ouvido com a dificuldade.' });
      if (o.causas.some((x) => !(CAUSAS_AUDITIVAS as readonly string[]).includes(x)))
        p.push({ campo: 'causas', mensagem: 'Causa fora da lista.' });
      if (o.causas.length === 0 && !o.outrasCausas)
        p.push({ campo: 'causas', mensagem: 'Marque ao menos uma causa (ou descreva outra).' });
      break;
    }
    case 'medicamento': {
      const o = c.dados;
      if (!/^06\d{8}$/.test(codigo(o.medicamento)))
        p.push({
          campo: 'medicamento',
          mensagem: 'O medicamento é um código do grupo 06 da tabela unificada.',
        });
      if (!cidValido(o.cidPrincipal)) p.push({ campo: 'cidPrincipal', mensagem: 'CID-10 inválido.' });
      if (!cidValido(o.cidSecundario)) p.push({ campo: 'cidSecundario', mensagem: 'CID-10 inválido.' });
      if (o.pesoKg !== null && (o.pesoKg <= 0 || o.pesoKg > 400))
        p.push({ campo: 'pesoKg', mensagem: 'Peso entre 0 e 400 kg.' });
      if (o.alturaCm !== null && (o.alturaCm < 20 || o.alturaCm > 250))
        p.push({ campo: 'alturaCm', mensagem: 'Altura entre 20 e 250 cm.' });
      if (o.quantidades.some((q) => q !== null && q < 0))
        p.push({ campo: 'quantidades', mensagem: 'Quantidade não pode ser negativa.' });
      if (o.quantidades[0] === null || o.quantidades[0] <= 0)
        p.push({ campo: 'quantidades', mensagem: 'Informe a quantidade do primeiro mês.' });
      if (!diaValido(o.periodoInicio) || !diaValido(o.periodoFim))
        p.push({ campo: 'periodo', mensagem: 'Data inválida (AAAA-MM-DD).' });
      else if (o.periodoInicio && o.periodoFim) {
        if (o.periodoFim < o.periodoInicio)
          p.push({ campo: 'periodo', mensagem: 'O fim do período vem depois do início.' });
        else if (competenciasDoPeriodoApac(o.periodoInicio, o.periodoFim) > 3)
          p.push({ campo: 'periodo', mensagem: 'O período do medicamento cabe em até 3 competências.' });
      } else if (o.periodoFim && !o.periodoInicio)
        p.push({ campo: 'periodo', mensagem: 'Informe o início do período.' });
      break;
    }
    case 'odontologia': {
      const o = c.dados;
      const m = new Set(o.marcas);
      if (o.marcas.some((x) => !(MARCAS_ODONTOLOGIA as readonly string[]).includes(x)))
        p.push({ campo: 'marcas', mensagem: 'Marca fora da lista.' });
      if (o.anomaliaCraniofacial && !o.descricaoAnomalia)
        p.push({ campo: 'descricaoAnomalia', mensagem: 'Descreva a anomalia craniofacial.' });
      if (m.has('troca_aparelho') && !o.justificativaTrocaAparelho)
        p.push({
          campo: 'justificativaTrocaAparelho',
          mensagem: 'A troca do aparelho pede a justificativa.',
        });
      if ((m.has('dente_incluso') || m.has('dente_impactado')) && !o.especificacaoDentes)
        p.push({ campo: 'especificacaoDentes', mensagem: 'Especifique os dentes inclusos ou impactados.' });
      if (m.has('com_osteotomia') && !m.has('remocao_cirurgica'))
        p.push({ campo: 'marcas', mensagem: 'Osteotomia só com a remoção cirúrgica.' });
      if (m.has('desdentado_total') && m.has('desdentado_parcial'))
        p.push({ campo: 'marcas', mensagem: 'Desdentado total ou parcial, não os dois.' });
      if (m.has('implante_metalico')) {
        if (o.quantidadeImplantes === null || o.quantidadeImplantes < 1 || o.quantidadeImplantes > 3)
          p.push({ campo: 'quantidadeImplantes', mensagem: 'De 1 a 3 implantes.' });
      } else if (o.quantidadeImplantes !== null)
        p.push({
          campo: 'quantidadeImplantes',
          mensagem: 'Quantidade de implantes só com o implante marcado.',
        });
      if (!o.tratamentoProposto)
        p.push({ campo: 'tratamentoProposto', mensagem: 'Descreva o tratamento proposto.' });
      break;
    }
  }
  return p;
}

/** Quantas competências (meses) o período toca: 2026-01-15 a 2026-03-10 são 3. */
export function competenciasDoPeriodoApac(inicio: string, fim: string): number {
  const a = Number(inicio.slice(0, 4)) * 12 + Number(inicio.slice(5, 7));
  const b = Number(fim.slice(0, 4)) * 12 + Number(fim.slice(5, 7));
  return b - a + 1;
}

// ── Sessões ──────────────────────────────────────────────────────────────────────────────────────────────

export type ComparecimentoSessao = 'compareceu' | 'faltou' | 'falta_justificada';
export type ModalidadeDialise = 'hemodialise' | 'dpa' | 'dpac' | 'capd' | 'dpi';
const PERITONEAL: readonly ModalidadeDialise[] = ['dpa', 'dpac', 'capd', 'dpi'];

export interface NovaSessaoApac {
  readonly data: string;
  /** O código SIGTAP da sessão; vazio usa o procedimento da APAC. */
  readonly procedimento: string;
  readonly quantidade: number;
  readonly comparecimento: ComparecimentoSessao;
  readonly modalidade: ModalidadeDialise | null;
  readonly kits: number | null;
}

export interface ApacParaSessao extends ApacParaComplemento {
  /** Validade autorizada (primeiro e último dia). */
  readonly validadeInicio: string | null;
  readonly validadeFim: string | null;
  readonly dataEncerramento: string | null;
}

/** A sessão entra na APAC autorizada, no período autorizado, até hoje e até o encerramento. */
export function problemasDaSessao(a: ApacParaSessao, s: NovaSessaoApac, hoje: string): ProblemaApac[] {
  const p: ProblemaApac[] = [];
  if (a.situacao !== 'autorizada')
    p.push({ campo: 'situacao', mensagem: 'A sessão só é registrada na APAC autorizada.' });
  if (!diaValido(s.data) || !s.data) {
    p.push({ campo: 'data', mensagem: 'Data inválida (AAAA-MM-DD).' });
    return p;
  }
  if (s.data > hoje) p.push({ campo: 'data', mensagem: 'A sessão não pode ser futura.' });
  if (a.validadeInicio && s.data < a.validadeInicio)
    p.push({ campo: 'data', mensagem: 'A sessão é anterior à validade da APAC.' });
  if (a.validadeFim && s.data > a.validadeFim)
    p.push({ campo: 'data', mensagem: 'A sessão passa da validade da APAC.' });
  if (a.dataEncerramento && s.data > a.dataEncerramento)
    p.push({ campo: 'data', mensagem: 'A sessão é posterior ao encerramento da APAC.' });
  if (!(s.quantidade > 0)) p.push({ campo: 'quantidade', mensagem: 'A quantidade é maior que zero.' });
  const familia = familiaLaudoDoProcedimento(s.procedimento || a.procedimento);
  if (familia === 'nefrologia') {
    if (s.comparecimento === 'compareceu' && s.modalidade === null)
      p.push({ campo: 'modalidade', mensagem: 'Informe a modalidade da diálise.' });
  } else if (s.modalidade !== null)
    p.push({ campo: 'modalidade', mensagem: 'A modalidade da diálise vale só na terapia renal.' });
  if (s.kits !== null) {
    if (s.modalidade === null || !PERITONEAL.includes(s.modalidade))
      p.push({ campo: 'kits', mensagem: 'Kits só na diálise peritoneal.' });
    else if (s.kits <= 0) p.push({ campo: 'kits', mensagem: 'A quantidade de kits é maior que zero.' });
  }
  return p;
}
