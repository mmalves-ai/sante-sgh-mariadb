// Histórias do catálogo: uma ou mais por componente de domínio, sempre com dados SINTÉTICOS.
import { urnProblema, type ContextoPaciente } from '@sgh/contratos';
import { h, ref, type Component, type VNode } from 'vue';
import {
  CAMINHOS_ICONES,
  PALETA_CLINICA,
  SanteAlerta,
  SanteAvisoColisao,
  SanteBotao,
  SanteCabecalhoPaciente,
  SanteCampoTexto,
  SanteChave,
  SanteData,
  SanteDialogo,
  SanteDialogoGravacao,
  SanteEstado,
  SanteHora,
  SanteIcone,
  SanteMarca,
  SanteMarcadores,
  SanteOpcoes,
  SantePassos,
  SanteSelecao,
  SanteTabela,
  pacoteDeMarca,
  type NomeIcone,
} from '../src/index.js';

export interface Historia {
  readonly id: string;
  /** Nome do componente exportado por @sgh/ui que a história cobre. */
  readonly componente: string;
  readonly titulo: string;
  readonly render: () => VNode | VNode[];
}

const paciente: ContextoPaciente = {
  identificacao: {
    nomeSocial: null,
    nomeCivil: 'Paciente Fictício Um',
    nascimento: '1980-05-17',
    idade: '46 anos',
    sexo: 'F',
    prontuario: '000123',
  },
  localizacao: {
    estabelecimento: 'Estabelecimento de teste',
    unidade: 'Unidade A',
    leito: '101-B',
    diasInternacao: 3,
    altaProvavel: null,
  },
  atendimento: { tipo: 'Internação', numero: '0001', convenio: 'Convênio de teste', medicoResponsavel: null },
  alergias: { situacao: 'nao-avaliadas' },
  alertas: [],
  homonimoNaUnidade: false,
  medidas: { peso: null, altura: null },
};

function comModelo<T>(componente: Component, inicial: T, props: Record<string, unknown> = {}): () => VNode {
  const v = ref(inicial) as { value: T };
  return () =>
    h(componente, { ...props, modelValue: v.value, 'onUpdate:modelValue': (n: T) => (v.value = n) });
}

const textoComEmoji = comModelo(SanteCampoTexto, 'Paciente refere dor 😀', {
  rotulo: 'Observação (emoji)',
  maxBytes: 60,
});
const textoComTroca = comModelo(SanteCampoTexto, 'PA ≥ 140 mmHg', {
  rotulo: 'Observação (troca proposta)',
  maxBytes: 60,
});
const textoValido = comModelo(SanteCampoTexto, '“Retorno” em 7 dias — trazer exames…', {
  rotulo: 'Observação',
  maxBytes: 60,
  multilinha: true,
});
const dataEditavel = comModelo(SanteData, null as string | null, {
  rotulo: 'Data de retorno',
  editavel: true,
});
const horaEditavel = comModelo(SanteHora, '0830' as string | null, { rotulo: 'Hora', editavel: true });
const passos = comModelo(SantePassos, '2', {
  passos: [
    { valor: '1', rotulo: 'Dados' },
    { valor: '2', rotulo: 'Conferência' },
    { valor: '3', rotulo: 'Conclusão' },
  ],
});
const opcoes = comModelo(SanteOpcoes, 'sistema', {
  legenda: 'Tema',
  opcoes: [
    { valor: 'claro', rotulo: 'Claro' },
    { valor: 'escuro', rotulo: 'Escuro' },
    { valor: 'sistema', rotulo: 'Igual ao computador' },
  ],
});
const selecao = comModelo(SanteSelecao, 'aa', {
  rotulo: 'Estabelecimento',
  opcoes: [
    { valor: 'aa', rotulo: 'Estabelecimento A' },
    { valor: 'bb', rotulo: 'Estabelecimento B' },
  ],
});
const marcadores = comModelo(SanteMarcadores, [2] as number[], {
  legenda: 'Convênios aceitos',
  opcoes: Array.from({ length: 24 }, (_, i) => ({ valor: i + 1, rotulo: `Convênio sintético ${i + 1}` })),
});
const dialogoAberto = ref(true);
const gravacaoAberta = ref(true);
const chaveLigada = ref(true);

const LINHAS = Array.from({ length: 87 }, (_, i) => ({
  id: i + 1,
  nome: `Item sintético ${i + 1}`,
  situacao: i % 3 === 0 ? 'Pendente' : 'Concluído',
}));

export const HISTORIAS: readonly Historia[] = [
  {
    id: 'estado-risco',
    componente: 'SanteEstado',
    titulo: 'Classificação de risco (5 cores do protocolo)',
    render: () =>
      PALETA_CLINICA.filter((e) => e.grupo === 'risco').map((e) => h(SanteEstado, { estado: e.id })),
  },
  {
    id: 'estado-leito',
    componente: 'SanteEstado',
    titulo: 'Estados de leito (8)',
    render: () =>
      PALETA_CLINICA.filter((e) => e.grupo === 'leito').map((e) => h(SanteEstado, { estado: e.id })),
  },
  {
    id: 'alerta',
    componente: 'SanteAlerta',
    titulo: 'Alerta clínico, aviso e informação (sempre ícone e texto)',
    render: () => [
      h(SanteAlerta, { texto: 'ALERGIA: dipirona' }),
      h(SanteAlerta, { texto: 'Isolamento de contato', variante: 'aviso' }),
      h(SanteAlerta, { texto: 'Resultado novo', variante: 'info', icone: 'info' }),
    ],
  },
  {
    id: 'botao',
    componente: 'SanteBotao',
    titulo: 'Botões: principal, secundário, texto e destrutivo (contorno + confirmação)',
    render: () => [
      h(SanteBotao, { rotulo: 'Salvar' }),
      h(SanteBotao, { rotulo: 'Cancelar', variante: 'secundario' }),
      h(SanteBotao, { rotulo: 'Ver detalhes', variante: 'texto' }),
      h(SanteBotao, {
        rotulo: 'Excluir',
        variante: 'destrutivo',
        confirmacao: 'Excluir este item sintético?',
      }),
    ],
  },
  {
    id: 'texto',
    componente: 'SanteCampoTexto',
    titulo: 'Campo de texto CP1252: válido, emoji recusado e troca proposta',
    render: () => [textoValido(), textoComEmoji(), textoComTroca()],
  },
  {
    id: 'data',
    componente: 'SanteData',
    titulo: 'Data: vazia, válida, fora da faixa (dado inválido) e editável',
    render: () => [
      h(SanteData, { modelValue: null }),
      h(SanteData, { modelValue: '2026-10-19' }),
      h(SanteData, { modelValue: '5202-03-01' }),
      dataEditavel(),
    ],
  },
  {
    id: 'hora',
    componente: 'SanteHora',
    titulo: 'Hora (quatro dígitos, até a troca do componente)',
    render: () => [h(SanteHora, { modelValue: '0801' }), horaEditavel()],
  },
  {
    id: 'colisao',
    componente: 'SanteAvisoColisao',
    titulo: 'Aviso de colisão (registro alterado no outro sistema)',
    render: () =>
      h(SanteAvisoColisao, {
        problema: {
          type: urnProblema('conflito-de-versao'),
          status: 409,
          correlacao: 'corr-sintetica',
          alteradoPor: 'legado',
          alteracoes: [
            {
              campo: 'observacao',
              rotulo: 'Observação',
              lido: 'Retorno em 7 dias',
              atual: 'Retorno em 10 dias',
            },
          ],
        },
      }),
  },
  {
    id: 'tabela',
    componente: 'SanteTabela',
    titulo: 'Tabela paginada no servidor (dados sintéticos)',
    render: () =>
      h(SanteTabela, {
        rotulo: 'Buscar itens',
        chave: 'id',
        tamanhoPagina: 10,
        colunas: [
          { campo: 'id', rotulo: 'Código', ordenavel: true },
          { campo: 'nome', rotulo: 'Nome', ordenavel: true },
          { campo: 'situacao', rotulo: 'Situação' },
        ],
        carregar: async (c: { pagina: number; tamanho: number; filtro: string }) => {
          const l = LINHAS.filter((x) => x.nome.includes(c.filtro));
          return { itens: l.slice(c.pagina * c.tamanho, (c.pagina + 1) * c.tamanho), total: l.length };
        },
      }),
  },
  {
    id: 'paciente-nao-avaliadas',
    componente: 'SanteCabecalhoPaciente',
    titulo: 'Cabeçalho do paciente: alergias não avaliadas (alerta)',
    render: () => h(SanteCabecalhoPaciente, { paciente }),
  },
  {
    id: 'paciente-alergias',
    componente: 'SanteCabecalhoPaciente',
    titulo: 'Cabeçalho do paciente: lista de alergias, nome social, homônimo e alertas',
    render: () =>
      h(SanteCabecalhoPaciente, {
        paciente: {
          ...paciente,
          identificacao: { ...paciente.identificacao, nomeSocial: 'Nome Social Fictício' },
          alergias: { situacao: 'lista', itens: ['dipirona', 'látex'] },
          homonimoNaUnidade: true,
          alertas: [{ id: 'iso', texto: 'Isolamento de contato' }],
          medidas: { peso: { valor: '70 kg', data: '2026-10-18' }, altura: null },
        },
      }),
  },
  {
    id: 'paciente-nega',
    componente: 'SanteCabecalhoPaciente',
    titulo: 'Cabeçalho do paciente: nega alergias',
    render: () => h(SanteCabecalhoPaciente, { paciente: { ...paciente, alergias: { situacao: 'nega' } } }),
  },
  {
    id: 'passos',
    componente: 'SantePassos',
    titulo: 'Etapas (Stepper com ARIA corrigido)',
    render: () => passos(),
  },
  {
    id: 'marca',
    componente: 'SanteMarca',
    titulo: 'Marca por configuração (provisória)',
    render: () => [
      h(SanteMarca, { pacote: pacoteDeMarca('rede-sante'), produto: 'Nome do produto (parâmetro)' }),
    ],
  },
  { id: 'opcoes', componente: 'SanteOpcoes', titulo: 'Grupo de opções', render: () => opcoes() },
  { id: 'selecao', componente: 'SanteSelecao', titulo: 'Seleção', render: () => selecao() },
  {
    id: 'marcadores',
    componente: 'SanteMarcadores',
    titulo: 'Seleção múltipla com busca',
    render: () => marcadores(),
  },
  {
    id: 'chave',
    componente: 'SanteChave',
    titulo: 'Chave liga/desliga',
    render: () => [
      h(SanteChave, {
        ligada: chaveLigada.value,
        rotulo: 'Acesso liberado',
        descricao: 'O login entra no sistema.',
        onAlternar: (v: boolean) => (chaveLigada.value = v),
      }),
      h(SanteChave, {
        ligada: false,
        rotulo: 'Administrador',
        desabilitada: true,
        motivo: 'Sempre deve haver pelo menos um administrador ativo.',
      }),
    ],
  },
  {
    id: 'dialogo',
    componente: 'SanteDialogo',
    titulo: 'Diálogo modal',
    render: () =>
      h(
        SanteDialogo,
        {
          titulo: 'Diálogo de exemplo',
          visivel: dialogoAberto.value,
          'onUpdate:visivel': (v: boolean) => (dialogoAberto.value = v),
        },
        () => 'Conteúdo sintético.',
      ),
  },
  {
    id: 'dialogo-gravacao',
    componente: 'SanteDialogoGravacao',
    titulo: 'Diálogo de gravação: motivo e senha de novo (reautenticação)',
    render: () =>
      h(SanteDialogoGravacao, {
        visivel: gravacaoAberta.value,
        'onUpdate:visivel': (v: boolean) => (gravacaoAberta.value = v),
        pedido: {
          titulo: 'Inativar o cadastro sintético',
          texto: 'O cadastro deixa de aparecer nas listas; o histórico fica.',
          motivo: 'Motivo da inativação',
          senha: true,
          confirmar: 'Inativar',
          gravar: async () => undefined,
        },
      }),
  },
  {
    id: 'icones',
    componente: 'SanteIcone',
    titulo: 'Ícones',
    render: () =>
      (Object.keys(CAMINHOS_ICONES) as NomeIcone[]).map((n) =>
        h('span', { class: 'cat-icone' }, [h(SanteIcone, { nome: n }), ` ${n}`]),
      ),
  },
];
