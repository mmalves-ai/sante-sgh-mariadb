// Formulário novo SINTÉTICO (M45, etapa 1): uma escala de duas perguntas pontuadas com o total calculado (a forma de
// Braden e Morse), uma conduta que só aparece com o total baixo, peso com unidade e faixa, e a data da avaliação; dois
// casos de teste verdes. É o conteúdo de exemplo do construtor, da memória da API (dev e ci), das assinaturas, da
// integração na cópia e do E2E: nada de escala licenciada (regra comum 6 da Fase 5).
import type { CasoFormularioNovo, DefinicaoFormularioNovo, PerguntaFormularioNovo } from '@sgh/contratos';
import { CONSTANTES_DUBLE, type ConstantesDoCenario } from './plano.js';

export const perguntaFormularioNovo = (
  p: Partial<PerguntaFormularioNovo> & Pick<PerguntaFormularioNovo, 'linkId'>,
): PerguntaFormularioNovo => ({
  tipo: 'texto',
  titulo: `Pergunta ${p.linkId}`,
  obrigatorio: false,
  unidade: null,
  minimo: null,
  maximo: null,
  opcoes: [],
  habilitar: null,
  calcular: null,
  reuso: null,
  itens: [],
  ...p,
});

const P = perguntaFormularioNovo;

export const FORMULARIO_NOVO_SINTETICO: DefinicaoFormularioNovo = {
  codigo: 'SGHESC',
  titulo: 'Escala sintética SINTETICO M45',
  tipoRegistro: 'evolucao',
  especialidades: [],
  perguntas: [
    P({
      linkId: 'avaliacao',
      tipo: 'secao',
      titulo: 'Avaliação',
      itens: [
        P({
          linkId: 'mobilidade',
          tipo: 'escolha',
          titulo: 'Mobilidade',
          obrigatorio: true,
          opcoes: [
            { codigo: 'acamado', texto: 'Acamado', pontos: 1 },
            { codigo: 'limitada', texto: 'Limitada', pontos: 2 },
            { codigo: 'deambula', texto: 'Deambula', pontos: 4 },
          ],
        }),
        P({
          linkId: 'riscos',
          tipo: 'multipla',
          titulo: 'Fatores de risco',
          opcoes: [
            { codigo: 'umidade', texto: 'Umidade', pontos: 1 },
            { codigo: 'friccao', texto: 'Fricção', pontos: 2 },
          ],
        }),
        P({
          linkId: 'total',
          tipo: 'inteiro',
          titulo: 'Total',
          calcular: { '+': [{ var: 'mobilidade' }, { var: 'riscos' }] },
        }),
        P({
          linkId: 'conduta',
          tipo: 'texto-formatado',
          titulo: 'Conduta',
          habilitar: { '<=': [{ var: 'total' }, 3] },
        }),
        P({ linkId: 'peso', tipo: 'decimal', titulo: 'Peso', unidade: 'kg', minimo: 0.5, maximo: 400 }),
        P({ linkId: 'avaliado_em', tipo: 'data', titulo: 'Avaliado em' }),
      ],
    }),
  ],
};

export const CASOS_FORMULARIO_NOVO_SINTETICO: CasoFormularioNovo[] = [
  {
    nome: 'acamado com fricção',
    respostas: { mobilidade: 'acamado', riscos: ['friccao'] },
    esperado: { total: 3 },
    habilitadasEsperadas: ['avaliacao', 'mobilidade', 'riscos', 'total', 'conduta', 'peso', 'avaliado_em'],
  },
  {
    nome: 'deambula',
    respostas: { mobilidade: 'deambula', riscos: [] },
    esperado: { total: 4 },
    habilitadasEsperadas: ['avaliacao', 'mobilidade', 'riscos', 'total', 'peso', 'avaliado_em'],
  },
];

/**
 * Constantes SINTÉTICAS do cenário para os testes do plano e do adaptador (fixture, assinatura de recusa): o tipo de
 * atendimento e a fonte do vínculo preenchidos, como o perfil passivo exige. Nunca usadas pela API (lá valem as do
 * dublê, que recusam até a captura); a integração na cópia usa os valores mais frequentes medidos na própria cópia.
 */
export const CONSTANTES_SINTETICAS: ConstantesDoCenario = {
  ...CONSTANTES_DUBLE,
  tipoAtendimento: 1,
  fonteVinculo: 'SINTETICO M45',
};
