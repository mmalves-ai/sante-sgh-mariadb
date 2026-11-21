// Plano de publicação do formulário novo como modelo do formulário de origem (M45, etapa 1; ficha seção 5,
// `pep.publicarFormularioNovo`; cap-11 §11.1). Puro: da definição publicada às linhas que a receita grava, em ordem
// (modelo → respostas cadastradas novas → perguntas novas → respostas das perguntas → vínculos → especialidades),
// com chaves LÓGICAS (os IDs vêm dos generators pelos triggers BEFORE INSERT do legado, com laço anticolisão). O
// plano nunca altera nem apaga nada do legado: só inclui o que não existe (reuso do banco de perguntas e das
// respostas cadastradas) e nunca reaproveita código de modelo. As colunas que o construtor não decide (fase,
// cabeçalho, tipo de atendimento, layout de impressão, histórico clínico) vêm das CONSTANTES do cenário controlado
// do M36: sem a captura, a operação fica `especificada` (ficha) e o plano só serve ao dublê e à tela.
import type {
  DefinicaoFormularioNovo,
  PerguntaFormularioNovo,
  TipoPerguntaFormularioNovo,
  TipoRegistroFormularioNovo,
} from '@sgh/contratos';
import { percorrerPerguntas } from './definicao.js';

/** Código do tipo de campo do modelo de origem por tipo do construtor (ref 04 §1.2, medido na cópia). */
export const CODIGO_DO_TIPO_DE_CAMPO: Readonly<Record<TipoPerguntaFormularioNovo, string>> = {
  secao: '1',
  'texto-formatado': '5',
  decimal: '6',
  inteiro: '7',
  texto: '11',
  data: '2',
  hora: '3',
  escolha: '13',
  'escolha-com-texto': '8',
  multipla: '12',
};

/** Tipo do construtor pelo código do tipo de campo (para mostrar o banco de perguntas); `4` (sim/não) é escolha. */
export function tipoDoCodigoDeCampo(t: string | null): TipoPerguntaFormularioNovo | null {
  const s = (t ?? '').trim();
  if (s === '4') return 'escolha';
  const achado = (Object.entries(CODIGO_DO_TIPO_DE_CAMPO) as [TipoPerguntaFormularioNovo, string][]).find(
    ([, v]) => v === s,
  );
  return achado ? achado[0] : null;
}

/** Tipo de documento clínico (7 linhas na cópia): 1 Diagnóstico, 2 Evolução, 3 Anamnese, 4 Resumo clínico, 6 Sumário de alta. */
export const TIPO_COMPOSICAO_DO_REGISTRO: Readonly<Record<TipoRegistroFormularioNovo, number>> = {
  diagnostico: 1,
  evolucao: 2,
  anamnese: 3,
  'resumo-clinico': 4,
  'sumario-alta': 6,
};

/** Recusa do plano (o serviço da API a traduz para a tela: 409 ou a funcionalidade em consulta). */
export type CodigoRecusaPlano = 'codigo-em-uso' | 'pergunta-reusada-mudou' | 'constantes-pendentes';

export class ErroPlanoPublicacao extends Error {
  override readonly name = 'ErroPlanoPublicacao';
  readonly codigo: CodigoRecusaPlano;
  constructor(codigo: CodigoRecusaPlano, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Por que o plano não sai sem a captura do cenário controlado (texto visto pelo administrador). */
export const MOTIVO_CONSTANTES_PENDENTES =
  'Criar o formulário novo como modelo do prontuário aguarda o cenário controlado: o tipo de atendimento do modelo e a fonte dos vínculos ainda não foram capturados. Até lá a versão publicada vale só no Sante SGH.';

/**
 * Constantes que o cenário controlado do M36 mostra (o administrador do PEP cria no outro sistema um modelo de teste
 * com os mesmos tipos de pergunta; a captura dá a referência). Valores mais frequentes na cópia, só como ponto de
 * partida do dublê: FASE 2 (51 de 67), CODCAB 5 (63 de 67), LAYOUT 'G' (65 de 67), histórico clínico preenchido em 46.
 */
export interface ConstantesDoCenario {
  readonly fase: number | null;
  readonly codCab: number | null;
  /**
   * TP_ATENDIMENTO do modelo (CHECK 1 a 4; significado conferido no cenário). O perfil passivo o tem preenchido em 67
   * de 67 modelos: nulo, o plano recusa (`constantes-pendentes`) em vez de gravar um valor que o perfil nunca tem.
   */
  readonly tipoAtendimento: 1 | 2 | 3 | 4 | null;
  readonly layoutImpressao: 'E' | 'G';
  readonly manterHistorico: 1 | 2 | 3;
  /**
   * Fonte do vínculo do campo ao modelo (preenchida em 2.832 de 2.832 vínculos na cópia): a fonte do vínculo, como o cenário grava. Nula,
   * o plano recusa (`constantes-pendentes`).
   */
  readonly fonteVinculo: string | null;
}

/** Sem a captura, o tipo de atendimento e a fonte ficam nulos: o plano recusa (a ponte fica em consulta, POL-3). */
export const CONSTANTES_DUBLE: ConstantesDoCenario = {
  fase: 2,
  codCab: 5,
  tipoAtendimento: null,
  layoutImpressao: 'G',
  manterHistorico: 1,
  fonteVinculo: null,
};

/** Pergunta ativa do banco do formulário de origem (leitura do adaptador; só definição, nunca resposta). */
export interface PerguntaBancoLegado {
  readonly id: number;
  readonly descricao: string;
  readonly tipoperg: string;
  readonly unidade: string | null;
  readonly ativo: boolean;
  /** Textos das opções na ordem cadastrada (escolhas); vazio nas demais. */
  readonly opcoes: readonly string[];
}

/** Resposta cadastrada (texto de opção) existente, para reuso exato. */
export interface RespostaCadastradaLegado {
  readonly cod: number;
  readonly descricao: string;
}

const normal = (s: string | null | undefined) =>
  (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase();

/** A pergunta do banco serve para reuso? Mesmo título, tipo, unidade e opções na mesma ordem; e ativa. */
export function perguntaCompativel(p: PerguntaFormularioNovo, b: PerguntaBancoLegado): boolean {
  if (!b.ativo || p.tipo === 'secao') return false;
  if (normal(p.titulo) !== normal(b.descricao)) return false;
  if (CODIGO_DO_TIPO_DE_CAMPO[p.tipo] !== b.tipoperg.trim()) return false;
  if (normal(p.unidade) !== normal(b.unidade)) return false;
  if (p.opcoes.length !== b.opcoes.length) return false;
  return p.opcoes.every((o, i) => normal(o.texto) === normal(b.opcoes[i]));
}

/** Sugestões de reuso por pergunta (cap-11 §11.1: o banco de perguntas e opções é reaproveitado). */
export function sugerirReuso(
  def: Pick<DefinicaoFormularioNovo, 'perguntas'>,
  banco: readonly PerguntaBancoLegado[],
): Map<string, number> {
  const s = new Map<string, number>();
  for (const { pergunta: p } of percorrerPerguntas(def)) {
    const b = banco.find((x) => perguntaCompativel(p, x));
    if (b) s.set(p.linkId, b.id);
  }
  return s;
}

// ── Código do modelo ───────────────────────────────────────────────────────────────────────────────────

/**
 * Código do modelo do formulário de origem para a versão: o código da definição na versão 1; nas seguintes, o
 * código com o sufixo `V<n>` (cortado para caber em 10). Nunca reaproveita código existente (ficha seção 5): se o
 * candidato estiver em uso, recusa (o administrador escolhe outro código).
 */
export function codigoModeloDaVersao(
  codigo: string,
  versao: number,
  existentes: ReadonlySet<string>,
): string {
  const sufixo = versao <= 1 ? '' : `V${versao}`;
  const candidato = `${codigo.slice(0, 10 - sufixo.length)}${sufixo}`;
  if (existentes.has(candidato.toUpperCase()))
    throw new ErroPlanoPublicacao(
      'codigo-em-uso',
      `O código ${candidato} já existe no prontuário: escolha outro código para o formulário.`,
    );
  return candidato;
}

// ── Plano ──────────────────────────────────────────────────────────────────────────────────────────────

/** Classe do valor de cada coluna gravada (o formato das assinaturas do M03). */
export type ClasseValor =
  | { readonly classe: 'generator' }
  | { readonly classe: 'entrada'; readonly valor: string | number | null }
  | { readonly classe: 'constante'; readonly valor: string | number | null }
  | { readonly classe: 'ligacao'; readonly chave: string };

/**
 * Papel da linha no plano. As tabelas do modelo próprio guardam o banco de campos e o vínculo na mesma tabela
 * (`modelo_campo` e `modelo_campo_opcao`), por isso o papel distingue as linhas:
 * - `modelo`: o próprio modelo de documento clínico;
 * - `banco`: item do banco reaproveitável (campo cadastrado ou texto de opção cadastrado);
 * - `vinculo`: ligação ao modelo (opção da pergunta, campo no modelo, especialidade do modelo).
 */
export type PapelLinhaPlano = 'modelo' | 'banco' | 'vinculo';

/**
 * Linha do plano. DÍVIDA (pedido 2 do lote 04-pep-1, decisão do dono): as chaves de `colunas` ainda são as colunas do
 * formulário de origem (ID_EVOLUCAO, ID_PRPERGUNTA, TIPOPERG, COD...), porque o plano é a ponte com o sistema de origem.
 * Elas somem quando a ponte for aposentada ou levada para o conector.
 */
export interface LinhaPlano {
  readonly tabela:
    'modelo_documento_clinico' | 'modelo_campo_opcao' | 'modelo_campo' | 'modelo_especialidade';
  readonly papel: PapelLinhaPlano;
  /** Chave lógica da linha (outras linhas a citam por `ligacao`). */
  readonly chave: string;
  readonly colunas: Readonly<Record<string, ClasseValor>>;
}

export interface PlanoPublicacao {
  readonly codigoModelo: string;
  readonly linhas: readonly LinhaPlano[];
  /** Perguntas reaproveitadas do banco (linkId → ID), relidas como condição antes de gravar. */
  readonly reusadas: ReadonlyMap<string, number>;
  /** Respostas cadastradas reaproveitadas (texto normalizado → COD), relidas antes de gravar. */
  readonly respostasReusadas: ReadonlyMap<string, number>;
}

export interface EntradaPlano {
  readonly definicao: DefinicaoFormularioNovo;
  readonly versao: number;
  readonly codigosExistentes: ReadonlySet<string>;
  readonly banco: readonly PerguntaBancoLegado[];
  readonly respostasCadastradas: readonly RespostaCadastradaLegado[];
  readonly constantes: ConstantesDoCenario;
}

const ent = (valor: string | number | null): ClasseValor => ({ classe: 'entrada', valor });
const cst = (valor: string | number | null): ClasseValor => ({ classe: 'constante', valor });
const lig = (chave: string): ClasseValor => ({ classe: 'ligacao', chave });
const GEN: ClasseValor = { classe: 'generator' };
const tf = (b: boolean) => (b ? 'T' : 'F');

/**
 * Plano da publicação, alinhado à referência de perfil `modelo-misto` (classes por coluna): o tipo de atendimento e a
 * fonte do vínculo nunca nulos (vêm do cenário; sem eles, recusa), a unidade vazia como '' (como 1.383 de 1.514
 * perguntas), e as sentinelas 0 do histórico clínico do modelo e do tamanho do componente da pergunta.
 */
export function planoDePublicacao(e: EntradaPlano): PlanoPublicacao {
  const { definicao: def, constantes: k } = e;
  if (k.tipoAtendimento === null || k.fonteVinculo === null || k.fonteVinculo.trim() === '')
    throw new ErroPlanoPublicacao('constantes-pendentes', MOTIVO_CONSTANTES_PENDENTES);
  const codigoModelo = codigoModeloDaVersao(def.codigo, e.versao, e.codigosExistentes);
  const linhas: LinhaPlano[] = [];
  const reusadas = new Map<string, number>();
  const respostasReusadas = new Map<string, number>();
  const porId = new Map(e.banco.map((b) => [b.id, b]));
  const cadPorTexto = new Map(e.respostasCadastradas.map((r) => [normal(r.descricao), r.cod]));

  linhas.push({
    tabela: 'modelo_documento_clinico',
    papel: 'modelo',
    chave: 'modelo',
    colunas: {
      ID_EVOLUCAO: GEN,
      COD: ent(codigoModelo),
      DESCRICAO: ent(def.titulo),
      ID_PRTPCOMP: ent(TIPO_COMPOSICAO_DO_REGISTRO[def.tipoRegistro]),
      FASE: cst(k.fase),
      CODCAB: cst(k.codCab),
      TP_ATENDIMENTO: ent(k.tipoAtendimento),
      LAYOUT_VISUALIZACAO_IMPRESSAO: cst(k.layoutImpressao),
      HIST_CLINICO_ABA: cst(0),
      HIST_CLINICO_PERIODO: cst(0),
    },
  });

  const cadNovas = new Map<string, string>();
  const chaveCad = (texto: string): ClasseValor => {
    const n = normal(texto);
    const existente = cadPorTexto.get(n);
    if (existente !== undefined) {
      respostasReusadas.set(n, existente);
      return ent(existente);
    }
    let chave = cadNovas.get(n);
    if (!chave) {
      chave = `cadresp:${cadNovas.size + 1}`;
      cadNovas.set(n, chave);
      linhas.push({
        tabela: 'modelo_campo_opcao',
        papel: 'banco',
        chave,
        colunas: { COD: GEN, DESCRICAO: ent(texto.trim()) },
      });
    }
    return lig(chave);
  };

  const todas = percorrerPerguntas(def);
  const perguntaDe = new Map<string, ClasseValor>();
  for (const { pergunta: p } of todas) {
    const reuso = p.reuso !== null ? porId.get(p.reuso) : undefined;
    if (p.reuso !== null) {
      if (!reuso || !perguntaCompativel(p, reuso))
        throw new ErroPlanoPublicacao(
          'pergunta-reusada-mudou',
          `A pergunta reaproveitada de "${p.linkId}" não existe, está inativa ou mudou.`,
        );
      reusadas.set(p.linkId, reuso.id);
      perguntaDe.set(p.linkId, ent(reuso.id));
      continue;
    }
    const chave = `pergunta:${p.linkId}`;
    perguntaDe.set(p.linkId, lig(chave));
    linhas.push({
      tabela: 'modelo_campo',
      papel: 'banco',
      chave,
      colunas: {
        ID: GEN,
        COD_PERGUNTA: GEN,
        COLUNA: cst(0),
        DESCRICAO: ent(p.titulo.trim()),
        TIPOPERG: ent(CODIGO_DO_TIPO_DE_CAMPO[p.tipo]),
        UNIDPERG: ent(p.unidade?.trim() ?? ''),
        ATIVO: cst('T'),
        MANTERHIST: cst(k.manterHistorico),
        ALTURA_COMPONENTE: cst(0),
        LARGURA_COMPONENTE: cst(0),
      },
    });
    // Respostas da pergunta: uma por opção (ORDEM a partir de 1, com o texto cadastrado); nas demais, a resposta
    // da própria pergunta (ORDEM 0, sem texto): medido na cópia, 1.017 perguntas com ORDEM 0 e COD vazio.
    if (p.opcoes.length > 0) {
      p.opcoes.forEach((o, i) =>
        linhas.push({
          tabela: 'modelo_campo_opcao',
          papel: 'vinculo',
          chave: `resposta:${p.linkId}:${o.codigo}`,
          colunas: {
            ID_RESPOSTA: GEN,
            ID_PRPERGUNTA: lig(chave),
            COD: chaveCad(o.texto),
            ATIVO: cst('T'),
            ORDEM: ent(i + 1),
          },
        }),
      );
    } else if (p.tipo !== 'secao') {
      linhas.push({
        tabela: 'modelo_campo_opcao',
        papel: 'vinculo',
        chave: `resposta:${p.linkId}`,
        colunas: {
          ID_RESPOSTA: GEN,
          ID_PRPERGUNTA: lig(chave),
          COD: ent(null),
          ATIVO: cst('T'),
          ORDEM: ent(0),
        },
      });
    }
  }

  for (const { pergunta: p, ordem } of todas) {
    linhas.push({
      tabela: 'modelo_campo',
      papel: 'vinculo',
      chave: `vinculo:${p.linkId}`,
      colunas: {
        ID: GEN,
        ID_EVOLUCAO: lig('modelo'),
        ID_PRPERGUNTA: perguntaDe.get(p.linkId)!,
        ORDEM: ent(ordem),
        CAMPOOBRIG: ent(tf(p.obrigatorio)),
        FONTE: ent(k.fonteVinculo),
        VISAUTO: cst('F'),
        ESPACODUPLO: cst('F'),
        ATIVO: cst('T'),
        EXIBIR_HISTORICO_PERGUNTA: cst('F'),
        EXIBIR_TODOS_PROFISSIONAIS: cst('F'),
      },
    });
  }

  for (const esp of [...new Set(def.especialidades)].sort((a, b) => a - b))
    linhas.push({
      tabela: 'modelo_especialidade',
      papel: 'vinculo',
      chave: `especialidade:${esp}`,
      colunas: { ID_EVOLUCAO: lig('modelo'), ESPEC: ent(esp) },
    });

  return { codigoModelo, linhas, reusadas, respostasReusadas };
}

/** O que a receita `pep.publicarFormularioNovo` recebe: a versão vista, o plano e o retrato do que ele reaproveitou. */
export interface EntradaPublicacaoFormularioNovo {
  readonly formulario: number;
  readonly versao: number;
  readonly versaoEsperada: string;
  readonly contentHash: string;
  readonly codigo: string;
  readonly titulo: string;
  readonly plano: {
    readonly codigoModelo: string;
    readonly linhas: readonly LinhaPlano[];
    readonly reusadas: readonly {
      readonly id: number;
      readonly descricao: string;
      readonly tipoperg: string;
      readonly unidade: string | null;
      readonly opcoes: readonly string[];
    }[];
    readonly respostasReusadas: readonly { readonly texto: string; readonly cod: number }[];
  };
}

/**
 * A entrada da receita a partir da definição e do que foi lido do banco (o adaptador só conhece os contratos: o plano
 * vem montado daqui e é relido na transação, com o retrato das perguntas e das respostas cadastradas reaproveitadas).
 */
export function entradaDaPublicacao(
  e: EntradaPlano & {
    readonly formulario: number;
    readonly versaoEsperada: string;
    readonly contentHash: string;
  },
): EntradaPublicacaoFormularioNovo {
  const p = planoDePublicacao(e);
  const banco = new Map(e.banco.map((b) => [b.id, b]));
  const cad = new Map(e.respostasCadastradas.map((r) => [r.cod, r.descricao]));
  return {
    formulario: e.formulario,
    versao: e.versao,
    versaoEsperada: e.versaoEsperada,
    contentHash: e.contentHash,
    codigo: e.definicao.codigo,
    titulo: e.definicao.titulo,
    plano: {
      codigoModelo: p.codigoModelo,
      linhas: p.linhas,
      reusadas: [...new Set(p.reusadas.values())].map((id) => {
        const b = banco.get(id)!;
        return {
          id,
          descricao: b.descricao,
          tipoperg: b.tipoperg,
          unidade: b.unidade,
          opcoes: [...b.opcoes],
        };
      }),
      respostasReusadas: [...new Set(p.respostasReusadas.values())].map((cod) => ({
        texto: (cad.get(cod) ?? '').trim(),
        cod,
      })),
    },
  };
}

/** Contagem de linhas por tabela e papel (`tabela/papel`; o que a assinatura de `pep.publicarFormularioNovo` espera). */
export function contagemDoPlano(p: PlanoPublicacao): Record<string, number> {
  const c: Record<string, number> = {};
  for (const l of p.linhas) {
    const k = `${l.tabela}/${l.papel}`;
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}
