// Serviço do construtor de formulários novos (M45, etapa 1; ficha, seções 5 e 7; regras 3, 14 e 15): monta a lista e o
// detalhe (os casos de teste RECALCULADOS no servidor, o hash atual e a integridade do publicado) e confere cada passo
// do ciclo pelo domínio puro antes de gravar (definição sem problema, casos verdes, quatro olhos, hash visto). Os erros
// do domínio viram 409 com o código e os problemas da definição para a tela.
import {
  type DefinicaoFormularioNovo,
  esquemaCasoFormularioNovo,
  esquemaDefinicaoFormularioNovo,
  type EspecialidadeFormularioNovo,
  type PerguntaDoBanco,
  TIPOS_PERGUNTA_FORMULARIO_NOVO,
  type VersaoFormularioNovoDetalhe,
  type VersaoFormularioNovoResumo,
} from '@sgh/contratos';
import {
  casosVerdes,
  conferirAposentadoria,
  conferirDecisaoRevisao,
  conferirDefinicao,
  conferirEnvioRevisao,
  conferirPublicacao,
  CONSTANTES_DUBLE,
  contentHashFormularioNovo,
  entradaDaPublicacao,
  type EntradaPublicacaoFormularioNovo,
  ErroCicloFormularioNovo,
  ErroPlanoPublicacao,
  executarCasos,
  FORMATO_DEFINICAO_FORMULARIO_NOVO,
  percorrerPerguntas,
  publicadoIntegro,
  TIPOPERG_DO_TIPO,
  tipoDoTipoperg,
  type VersaoNoCiclo,
} from '@sgh/dominio-pep';
import type { EventoFormularioNovoLido, FormularioNovoLido } from './tipos-pep.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoFormularioNovo, PortaFormularioNovo } from './formulario-novo-porta.js';

export function problemaDoCiclo(e: unknown): ErroProblema {
  if (e instanceof ErroCicloFormularioNovo)
    return new ErroProblema('recusa-de-negocio', 409, 'Não gravado', e.message, {
      codigo: e.codigo,
      ...(e.problemas.length ? { problemas: e.problemas } : {}),
    });
  if (e instanceof ErroProblema) return e;
  throw e;
}

/**
 * Com a ponte ligada, o executor tem de poder gravar a criação do modelo: se recusa (receita especificada fora de dev e
 * ci, schema divergente, usuário sem liberação), a publicação é recusada com o motivo do executor (POL-3) em vez de
 * virar uma versão publicada só no Sante SGH, imutável e sem o modelo no prontuário.
 */
export function exigirExecucaoDaPonte(exec: {
  readonly pode: boolean;
  readonly motivo: string | null;
}): void {
  if (exec.pode) return;
  throw new ErroProblema(
    'recurso-desligado',
    403,
    'Funcionalidade em consulta',
    exec.motivo ??
      'A criação do formulário novo como modelo do prontuário não pode gravar agora neste estabelecimento.',
    { codigo: 'recurso-desligado' },
  );
}

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Formulário não encontrado',
    'Formulário novo não encontrado neste estabelecimento.',
  );

/** A definição e os casos guardados, conferidos pelo contrato (o que não confere não segue). */
function doLido(v: FormularioNovoLido) {
  const definicao = esquemaDefinicaoFormularioNovo.parse(v.definicao);
  const casos = v.casos.map((c) => esquemaCasoFormularioNovo.parse(c.caso));
  return { definicao, casos };
}

/** A versão no ciclo do domínio; os autores são todos os que a salvaram (eventos `salvo` da história). */
export function noCiclo(v: FormularioNovoLido, eventos: readonly EventoFormularioNovoLido[] = []): VersaoNoCiclo {
  const { definicao, casos } = doLido(v);
  return {
    estado: v.estado,
    definicao,
    casos,
    autor: v.autor,
    autores: [...new Set(eventos.filter((e) => e.tipo === 'salvo').map((e) => e.por))],
    aprovadoPor: v.aprovadoPor,
    contentHash: v.contentHash,
  };
}

export class ServicoFormularioNovo {
  constructor(private readonly porta: PortaFormularioNovo) {}

  async lerVersao(c: ContextoFormularioNovo, id: number): Promise<FormularioNovoLido> {
    const v = await this.porta.versao(c, id);
    if (!v) throw naoEncontrado();
    return v;
  }

  private resumo(v: FormularioNovoLido, hoje: string): VersaoFormularioNovoResumo {
    let verdes: number | null;
    try {
      const { definicao, casos } = doLido(v);
      verdes = executarCasos(definicao, casos, hoje).filter((r) => r.passou).length;
    } catch {
      verdes = null;
    }
    return {
      id: v.id,
      codigo: v.codigo,
      titulo: v.titulo,
      versao: v.versao,
      estado: v.estado,
      contentHash: v.contentHash,
      ponte: v.ponte,
      casos: v.casos.length,
      casosVerdes: verdes,
      atualizadoEm: v.atualizadoEm,
      idModeloLegado: v.idModeloLegado,
    };
  }

  async lista(c: ContextoFormularioNovo): Promise<VersaoFormularioNovoResumo[]> {
    const [vs, hoje] = await Promise.all([this.porta.versoes(c), this.porta.hoje(c)]);
    return vs.map((v) => this.resumo(v, hoje));
  }

  async detalhe(c: ContextoFormularioNovo, id: number): Promise<VersaoFormularioNovoDetalhe> {
    const [v, hoje, eventos] = await Promise.all([
      this.lerVersao(c, id),
      this.porta.hoje(c),
      this.porta.eventos(c, id),
    ]);
    const { definicao, casos } = doLido(v);
    return {
      ...this.resumo(v, hoje),
      versaoLinha: v.versaoLinha,
      autor: v.autor,
      contentHashAtual: await contentHashFormularioNovo(definicao),
      integro:
        v.contentHash === null ? null : await publicadoIntegro({ definicao, contentHash: v.contentHash }),
      codigoModelo: v.codModelo,
      eventos,
      definicao,
      casosTeste: casos,
      resultados: executarCasos(definicao, casos, hoje),
      aprovacao:
        v.aprovadoPor && v.aprovadoEm
          ? { por: v.aprovadoPor, em: v.aprovadoEm, parecer: v.parecer ?? '' }
          : null,
      motivoAposentadoria: v.motivoAposentadoria,
    };
  }

  /** Código novo: nem do prontuário nem de outro formulário novo (nunca reaproveitado). */
  async conferirCodigoNovo(c: ContextoFormularioNovo, codigo: string): Promise<void> {
    if ((await this.porta.codigosEmUso(c)).has(codigo.toUpperCase()))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Não gravado',
        `O código ${codigo} já existe: escolha outro.`,
        {
          codigo: 'codigo-em-uso',
          campos: ['definicao.codigo'],
        },
      );
  }

  async conferirEnvio(c: ContextoFormularioNovo, id: number): Promise<FormularioNovoLido> {
    const v = await this.lerVersao(c, id);
    try {
      conferirEnvioRevisao(noCiclo(v), await this.porta.hoje(c));
    } catch (e) {
      throw problemaDoCiclo(e);
    }
    return v;
  }

  async conferirDecisao(c: ContextoFormularioNovo, id: number, quem: string): Promise<FormularioNovoLido> {
    const [v, eventos] = await Promise.all([this.lerVersao(c, id), this.porta.eventos(c, id)]);
    try {
      conferirDecisaoRevisao(noCiclo(v, eventos), quem);
    } catch (e) {
      throw problemaDoCiclo(e);
    }
    return v;
  }

  async conferirPublicacao(
    c: ContextoFormularioNovo,
    id: number,
    hashEsperado: string,
    quemPublica: string,
  ): Promise<{ v: FormularioNovoLido; hash: string; definicao: DefinicaoFormularioNovo }> {
    const [v, eventos] = await Promise.all([this.lerVersao(c, id), this.porta.eventos(c, id)]);
    const ciclo = noCiclo(v, eventos);
    try {
      const hash = await conferirPublicacao(ciclo, hashEsperado, quemPublica, await this.porta.hoje(c));
      return { v, hash, definicao: ciclo.definicao };
    } catch (e) {
      throw problemaDoCiclo(e);
    }
  }

  /**
   * A entrada da receita `pep.publicarFormularioNovo` (só com a ponte ligada): o plano do domínio sobre o que a porta
   * leu do prontuário (códigos em uso, perguntas reaproveitadas, respostas cadastradas), relido depois na transação.
   * As constantes de `PREVOLUCAO`/`PRPADEVOL` são as do dublê até a captura do cenário controlado do M36 (a receita fica
   * desligada fora de dev e ci até lá).
   */
  async entradaDaPublicacao(
    c: ContextoFormularioNovo,
    v: FormularioNovoLido,
    definicao: DefinicaoFormularioNovo,
    contentHash: string,
    versaoEsperada: string,
  ): Promise<EntradaPublicacaoFormularioNovo> {
    const todas = percorrerPerguntas(definicao).map((x) => x.pergunta);
    const dados = await this.porta.dadosDoPlano(
      c,
      definicao.codigo,
      todas.filter((p) => p.reuso !== null).map((p) => p.reuso!),
      todas.flatMap((p) => p.opcoes.map((o) => o.texto)),
    );
    try {
      return entradaDaPublicacao({
        definicao,
        versao: v.versao,
        ...dados,
        constantes: CONSTANTES_DUBLE,
        formulario: v.id,
        versaoEsperada,
        contentHash,
      });
    } catch (x) {
      if (!(x instanceof ErroPlanoPublicacao)) throw x;
      // Sem a captura do cenário controlado o plano não sai: a criação do modelo fica em consulta (POL-3).
      if (x.codigo === 'constantes-pendentes')
        throw new ErroProblema('recurso-desligado', 403, 'Funcionalidade em consulta', x.message, {
          codigo: 'recurso-desligado',
        });
      throw new ErroProblema('recusa-de-negocio', 409, 'Não gravado', x.message, { codigo: x.codigo });
    }
  }

  async conferirAposentadoria(c: ContextoFormularioNovo, id: number): Promise<FormularioNovoLido> {
    const v = await this.lerVersao(c, id);
    try {
      conferirAposentadoria(v);
    } catch (e) {
      throw problemaDoCiclo(e);
    }
    return v;
  }

  async bancoDePerguntas(
    c: ContextoFormularioNovo,
    termo: string,
    tipo: (typeof TIPOS_PERGUNTA_FORMULARIO_NOVO)[number] | null,
  ): Promise<PerguntaDoBanco[]> {
    const tiposperg =
      tipo === null ? [] : tipo === 'escolha' ? [TIPOPERG_DO_TIPO.escolha, '4'] : [TIPOPERG_DO_TIPO[tipo]];
    const r = await this.porta.buscarPerguntas(c, termo, tiposperg);
    return r.map((p) => ({
      id: p.id,
      titulo: p.descricao,
      tipo: tipoDoTipoperg(p.tipoperg),
      unidade: p.unidade,
      opcoes: [...p.opcoes],
      usoEmModelos: p.usoEmModelos,
    }));
  }

  async especialidades(c: ContextoFormularioNovo): Promise<EspecialidadeFormularioNovo[]> {
    return (await this.porta.especialidades(c)).map((e) => ({ codigo: e.codigo, nome: e.nome }));
  }
}

export { casosVerdes, conferirDefinicao, executarCasos, FORMATO_DEFINICAO_FORMULARIO_NOVO };
