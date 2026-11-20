// Apoio dos controladores da recepção (M19): a liberação da funcionalidade (chave recepcao.senha, POL-3: construída
// completa e DESLIGADA até o turno simulado com guichês nos dois sistemas; o administrador liga por estabelecimento,
// setor — a recepção — ou pessoa), a gravação pelo executor (Idempotency-Key, trilha na mesma transação; na memória,
// pelo registrador da API), as gravações só do novo (SGH_ com a SGH_TRILHA junto) e o estado de cada ação para a tela.
// O totem grava com o usuário técnico do dispositivo (perfil Painel/Totem), nunca com login de pessoa.
import {
  EVENTOS_AUDITAVEIS,
  type GravacaoRecepcao,
  recursoDesligado,
  type ResultadoRecepcao,
} from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import { type ContextoOperacao, type DispositivoLidoLegado, operacao } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, linhaTrilha, problemaDoCadastro, type SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { TTL_CONFIG_NOVO_S } from '../config/public-api.js';
import type { ContextoRecepcao, GravadorSghRecepcao, PortaRecepcao } from './porta.js';

export const CHAVE_LIBERACAO_RECEPCAO = 'recepcao.senha';

const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a gravação da recepção fica desligada.';
export const MOTIVO_DESLIGADO =
  'A recepção ainda não foi liberada para gravar neste estabelecimento, recepção ou pessoa: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
const MOTIVO_PREREQUISITO =
  'A recepção tem pré-requisito pendente neste estabelecimento: o turno simulado com guichês nos dois sistemas, conferido pelo supervisor da recepção.';

/** Operações e a permissão de agir de cada uma (a tela esconde a ação sem as duas). */
export const OPERACOES_DA_RECEPCAO: Readonly<Record<string, string>> = {
  'recepcao.emitirSenha': 'recepcao.senha.emitir',
  'recepcao.chamarSenha': 'recepcao.senha.chamar',
  'recepcao.registrarEventoSenha': 'recepcao.senha.chamar',
  'recepcao.registrarChegada': 'recepcao.checkin.registrar',
  'recepcao.desfazerChegada': 'recepcao.checkin.registrar',
  'recepcao.abrirGuiche': 'recepcao.senha.chamar',
  'recepcao.fecharGuiche': 'recepcao.senha.chamar',
};

/** Permissão de cada evento da senha (o encaminhamento e os do local têm a sua). */
export function permissaoDoEvento(evento: string): string {
  if (evento === 'encaminhar') return 'recepcao.senha.encaminhar';
  if (['cancelarChamada', 'naoLocalizadoNoLocal', 'chamarNoLocal', 'liberarDoLocal'].includes(evento))
    return 'recepcao.fluxo.registrar';
  return 'recepcao.senha.chamar';
}

export interface AlvoSgh {
  readonly tabela: string;
  readonly id?: string | null;
  readonly chave?: string | null;
}

export class ApoioRecepcao {
  constructor(
    readonly porta: PortaRecepcao,
    private readonly trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dadosLiberacao(rede: string, hospital: string) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(rede, hospital),
      prerequisitos: await fonte.prerequisitos(rede, hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(this.cache.chave(rede, hospital, 'liberacao'), TTL_CONFIG_NOVO_S, carregar)
      : carregar();
  }

  /** A funcionalidade vale para a pessoa (ou o usuário técnico do totem) e o setor (a recepção)? */
  async liberacaoPara(
    rede: string,
    hospital: string,
    pessoa: string,
    setor: string | null,
  ): Promise<{ ligada: boolean; motivo: string | null }> {
    let dados: Awaited<ReturnType<ApoioRecepcao['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(rede, hospital);
    } catch {
      return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === CHAVE_LIBERACAO_RECEPCAO && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(CHAVE_LIBERACAO_RECEPCAO)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_RECEPCAO);
    const sujeito = { pessoa, ...(setor !== null ? { setor } : {}) };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return { ligada: false, motivo: soPrerequisito ? MOTIVO_PREREQUISITO : MOTIVO_DESLIGADO };
  }

  liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    return this.liberacaoPara(
      s.rede,
      s.hospital,
      s.login,
      setor === null || setor === undefined ? null : String(setor),
    );
  }

  async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Recepção em consulta', l.motivo ?? MOTIVO_DESLIGADO, {
        codigo: 'recurso-desligado',
      });
  }

  /** Estado da gravação para a tela: a liberação e cada operação (permissão + passo 0 do executor). */
  async gravacao(s: SessaoCadastro): Promise<GravacaoRecepcao> {
    const l = await this.liberacao(s);
    const operacoes: GravacaoRecepcao['operacoes'] = {};
    for (const [op, permissao] of Object.entries(OPERACOES_DA_RECEPCAO)) {
      if (!s.pode(permissao)) {
        operacoes[op] = { pode: false, motivo: 'Seu perfil não permite esta ação.' };
        continue;
      }
      if (!l.ligada) {
        operacoes[op] = { pode: false, motivo: l.motivo };
        continue;
      }
      const p = await this.porta.podeGravar(s.porta, op, s.login).catch(() => ({
        pode: false,
        codigo: 'indisponivel',
        motivo: 'O banco do estabelecimento está indisponível.',
      }));
      operacoes[op] = { pode: p.pode, motivo: p.motivo };
    }
    return { ligada: l.ligada, motivo: l.motivo, operacoes };
  }

  private async trilhaDaMemoria(
    c: ContextoRecepcao,
    usuario: string,
    op: string,
    estacao: string,
    correlacao: string,
    id: string,
  ): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    const receita = operacao(op).receita;
    await this.trilha.registrar({
      evento: receita.evento,
      rede: c.rede,
      hospital: c.hospital,
      usuario,
      estacao: estacao.slice(0, 80),
      correlacao: correlacao.slice(0, 64),
      recurso: receita.recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: id,
    });
  }

  /** Grava pelo executor (ou pela memória), com a liberação conferida e a trilha. */
  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoRecepcao> {
    await this.exigirLiberacao(s);
    const ctx = contextoOperacao(s, op);
    const r = await this.porta.executar(s.porta, op, entrada, ctx).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (!r.repetida)
      await this.trilhaDaMemoria(
        s.porta,
        s.login,
        op,
        estacaoDaRequisicao(s.req),
        correlacaoDaRequisicao(s.req, op),
        String(Object.values(r.resultado)[0] ?? ''),
      );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem };
  }

  /**
   * Grava pelo dispositivo (totem): o usuário técnico do dispositivo vai às colunas de usuário (como o totem do outro
   * sistema); a liberação vale pela recepção do dispositivo e pelo usuário técnico.
   */
  async executarDoDispositivo(
    d: DispositivoLidoLegado,
    rede: string,
    op: string,
    entrada: unknown,
    idempotencyKey: string,
    estacao: string,
  ): Promise<ResultadoRecepcao> {
    if (!d.usuarioLegado)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Totem sem usuário técnico',
        'Cadastre o usuário técnico do totem.',
        {
          codigo: 'dispositivo-sem-usuario',
        },
      );
    const l = await this.liberacaoPara(
      rede,
      d.hospital,
      d.usuarioLegado,
      d.recepcao === null ? null : String(d.recepcao),
    );
    if (!l.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Totem fora de serviço',
        'Procure a recepção para retirar a senha.',
        {
          codigo: 'recurso-desligado',
        },
      );
    const ctx: ContextoOperacao = {
      rede,
      hospital: d.hospital,
      traceId: `totem-${d.id}`.slice(0, 64),
      usuarioLegado: d.usuarioLegado,
      idempotencyKey,
      estacao: estacao.slice(0, 80),
    };
    const c = { rede, hospital: d.hospital };
    const r = await this.porta.executar(c, op, entrada, ctx).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (!r.repetida)
      await this.trilhaDaMemoria(
        c,
        d.usuarioLegado,
        op,
        estacao,
        ctx.traceId,
        String(Object.values(r.resultado)[0] ?? ''),
      );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem: 'Senha emitida.' };
  }

  /** Gravação só do novo (SGH_), com a SGH_TRILHA na mesma transação. */
  async sgh<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoSgh | ((r: T) => AlvoSgh),
    fn: (g: GravadorSghRecepcao) => Promise<T>,
  ): Promise<T> {
    const alvoDe = (r: T) => (typeof alvoOuFn === 'function' ? alvoOuFn(r) : alvoOuFn);
    const r = await this.porta
      .gravarSgh(s.porta, (x: T) => linhaTrilha(s, evento, recurso, evento, alvoDe(x)), fn)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const alvo = alvoDe(r);
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: alvo.id ?? '',
      });
    return r;
  }
}

export const EVENTOS_RECEPCAO = EVENTOS_AUDITAVEIS;
