// W0-08, parte 10 (mercado M4: PMOC e infraestrutura crítica): os modelos prontos de plano de manutenção da
// infraestrutura do estabelecimento (o PMOC de cada equipamento de ar condicionado, a limpeza do reservatório de água, o
// teste do grupo gerador e a inspeção da central de gases medicinais). Instalar um modelo grava um plano comum
// (SGH_MAN_PREVENTIVA, com o código e a versão do modelo; script 1108): ele se altera pela versão lida como qualquer
// plano (a versão anterior fica guardada com o motivo) e cada execução registrada é imutável. O relatório do PMOC
// (Lei 13.589/2018 e Portaria GM/MS 3.523/1998) sai dos planos do modelo "pmocAr" com as execuções do período e a
// assinatura do responsável técnico, que é cadastro do dono (parâmetro manutencao.pmocResponsavelTecnico).
import { z } from 'zod';
import type { AtividadePlano } from './vocabulario.js';

export interface ModeloPlanoInfra {
  /** Versão do texto do modelo: muda quando o roteiro muda; o plano instalado guarda a versão de onde veio. */
  readonly versao: number;
  readonly nome: string;
  readonly atividade: AtividadePlano;
  readonly periodicidade: { readonly quantidade: number; readonly unidade: 'dias' | 'meses' };
  /** A norma brasileira de onde vem o roteiro (impressa no relatório e no plano). */
  readonly norma: string;
  /** Roteiro do plano (vai para o PROCEDIMENTO do plano instalado; até 2000 caracteres, CP1252). */
  readonly procedimento: string;
  /** Entra no relatório do PMOC. */
  readonly pmoc: boolean;
}

export const MODELOS_PLANO_INFRA = {
  pmocAr: {
    versao: 1,
    nome: 'PMOC: equipamento de ar condicionado',
    atividade: 'preventiva',
    periodicidade: { quantidade: 1, unidade: 'meses' },
    norma: 'Lei 13.589/2018; Portaria GM/MS 3.523/1998; RE Anvisa 9/2003; ABNT NBR 13971',
    procedimento: [
      'PMOC (Lei 13.589/2018, Portaria GM/MS 3.523/1998, RE Anvisa 9/2003, ABNT NBR 13971).',
      '1. Filtros de ar: limpar ou trocar; registrar o estado (saturado, sujo, limpo).',
      '2. Bandeja de condensado e dreno: limpar, desobstruir e conferir o caimento; sem água parada.',
      '3. Serpentina do evaporador e do condensador: limpar e conferir a corrosão.',
      '4. Ventiladores, correias e mancais: conferir ruído, vibração e tensão da correia.',
      '5. Gabinete, isolamento e tomada de ar externo: conferir vedação, sujidade e renovação de ar.',
      '6. Medir temperatura e umidade do ambiente (RE 9/2003: 23 a 26 °C e 40 a 65 %).',
      '7. Corrente elétrica, pressões do gás refrigerante e vazamentos.',
      '8. Produtos de limpeza usados: só os registrados na Anvisa (anotar o nome).',
      'Semestral: análise da qualidade do ar interior (RE 9/2003) por laboratório, com o laudo anexado à execução.',
    ].join('\n'),
    pmoc: true,
  },
  reservatorioAgua: {
    versao: 1,
    nome: 'Limpeza e desinfecção do reservatório de água',
    atividade: 'preventiva',
    periodicidade: { quantidade: 6, unidade: 'meses' },
    norma: 'Portaria GM/MS 888/2021 (potabilidade); ABNT NBR 5626',
    procedimento: [
      'Limpeza e desinfecção do reservatório de água (Portaria GM/MS 888/2021; ABNT NBR 5626).',
      '1. Avisar os setores e fechar a entrada; esvaziar o reservatório guardando um palmo de água para a limpeza.',
      '2. Escovar paredes, fundo e tampa sem produto abrasivo; retirar a sujeira e enxaguar.',
      '3. Desinfetar com solução de hipoclorito registrada na Anvisa, no tempo de contato do fabricante.',
      '4. Enxaguar, encher e conferir tampa, vedação, extravasor e telas contra insetos.',
      '5. Medir o cloro residual livre na saída e registrar o valor.',
      '6. Coletar a amostra para análise de potabilidade (laboratório) e anexar o laudo à execução.',
    ].join('\n'),
    pmoc: false,
  },
  geradorEnergia: {
    versao: 1,
    nome: 'Teste do grupo gerador de emergência',
    atividade: 'inspecao',
    periodicidade: { quantidade: 1, unidade: 'meses' },
    norma: 'RDC 50/2002 (instalações elétricas de emergência); ABNT NBR 13534',
    procedimento: [
      'Teste do grupo gerador de emergência (RDC 50/2002; ABNT NBR 13534).',
      '1. Conferir nível de combustível, óleo lubrificante, líquido de arrefecimento e baterias.',
      '2. Partida pela simulação da falta de energia: anotar o tempo de comutação da chave de transferência.',
      '3. Funcionar com carga por pelo menos 30 minutos: anotar tensão, frequência, corrente e temperatura.',
      '4. Conferir vazamentos, ruído, vibração e o escapamento.',
      '5. Retorno à rede e reposição do combustível consumido.',
      '6. Conferir que os setores críticos (centro cirúrgico, UTI, emergência) ficaram alimentados durante o teste.',
    ].join('\n'),
    pmoc: false,
  },
  gasesMedicinais: {
    versao: 1,
    nome: 'Inspeção da central de gases medicinais',
    atividade: 'inspecao',
    periodicidade: { quantidade: 1, unidade: 'meses' },
    norma: 'RDC 50/2002; ABNT NBR 12188 (sistemas centralizados de gases medicinais)',
    procedimento: [
      'Inspeção da central de gases medicinais (RDC 50/2002; ABNT NBR 12188).',
      '1. Conferir pressões da central, dos reguladores e da rede; anotar os valores.',
      '2. Conferir o alarme de pressão baixa e de troca de bateria de cilindros (teste do alarme).',
      '3. Procurar vazamentos nas conexões, válvulas e postos de consumo (solução própria para oxigênio).',
      '4. Conferir a reserva (cilindros cheios e identificados) e a troca automática.',
      '5. Conferir o compressor de ar medicinal e a bomba de vácuo: filtros, purgadores, horímetro.',
      '6. Conferir a sinalização, o acesso livre e a ausência de óleo ou graxa na central.',
    ].join('\n'),
    pmoc: false,
  },
} as const satisfies Record<string, ModeloPlanoInfra>;
export type CodigoModeloPlano = keyof typeof MODELOS_PLANO_INFRA;
export const CODIGOS_MODELO_PLANO = Object.keys(MODELOS_PLANO_INFRA) as [
  CodigoModeloPlano,
  ...CodigoModeloPlano[],
];

/** As recusas próprias da instalação do modelo e do relatório do PMOC (a tela traduz pelo código). */
export type RecusaPmoc = 'modelo-instalado' | 'pmoc-sem-responsavel' | 'periodo-invalido';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');

/**
 * Instalar o modelo pronto no equipamento: vira um plano comum, com a periodicidade, a atividade e o roteiro do modelo
 * (alteráveis depois pela versão). O mesmo modelo ativo duas vezes no mesmo equipamento recusa.
 */
export const esquemaInstalarModeloPlano = z
  .object({
    equipamento: id,
    modelo: z.enum(CODIGOS_MODELO_PLANO),
    dataBase: data,
    executor: z.enum(['interno', 'contrato']).default('interno'),
    cobertura: id.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.executor === 'contrato' && v.cobertura === null)
      ctx.addIssue({ code: 'custom', path: ['cobertura'], message: 'Escolha o contrato de manutenção.' });
  });
export type InstalarModeloPlanoEntrada = z.infer<typeof esquemaInstalarModeloPlano>;

/** O período do relatório do PMOC (até 12 meses; o domínio confere a ordem). */
export const esquemaRelatorioPmoc = z.object({ de: data, ate: data }).strict();
export type RelatorioPmocEntrada = z.infer<typeof esquemaRelatorioPmoc>;

/** O responsável técnico do PMOC, lido do parâmetro "Nome; registro profissional; ART" (cadastro do dono). */
export interface ResponsavelPmoc {
  readonly nome: string;
  readonly registro: string;
  readonly art: string | null;
}

/** Lê o parâmetro do responsável técnico; vazio ou sem o registro: null (o relatório recusa). */
export function responsavelPmocDe(valor: string | null | undefined): ResponsavelPmoc | null {
  const partes = String(valor ?? '')
    .split(';')
    .map((x) => x.trim());
  const [nome = '', registro = '', art = ''] = partes;
  if (nome.length < 3 || registro.length < 3) return null;
  return { nome, registro, art: art || null };
}
