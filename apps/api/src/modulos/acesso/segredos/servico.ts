// M59-F3 (ficha do M59, seção 5, regras 1 e 7; cap-08 §8.11): o serviço das telas dos segredos de parceiros e das
// senhas secundárias. Junta o que a porta leu (nunca o valor), o cofre (a credencial do Sante existe?), o estado da
// receita no catálogo e a situação do hospital (sistema anterior desligado pelo M58 e contingência; padrão aberta), e
// devolve o que o domínio decide. A retirada no banco é a receita, pelo executor (que confere de novo na transação).
import {
  EXCECOES_SEGREDO_LEGADO,
  esquemaSegredosLegadoResposta,
  esquemaSenhasSecundariasResposta,
  type LinhaSegredoLegado,
  SEGREDOS_LEGADO,
  segredoCatalogado,
  type SegredosLegadoResposta,
  type SenhasSecundariasResposta,
  TAMANHO_PAGINA_SENHA_SECUNDARIA,
  TETO_LINHAS_SEGREDO,
} from '@sgh/contratos';
import {
  bloqueioRetiradaSegredo,
  bloqueioRetiradaSenhaSecundaria,
  contagemProtegida,
  referenciaDaColuna,
} from '@sgh/dominio-acesso';
import type { RegistroSegredoLido, TrilhaSegredo } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { Cofre } from '../../assinatura/public-api.js';
import type { ContextoSegredos, PortaSegredos } from './porta.js';

export const OPERACAO_SEGREDO = 'integracao.cifrarSegredoLegado';
export const OPERACAO_SENHA_SECUNDARIA = 'acesso.retirarSenhaSecundaria';

export interface EstadoReceita {
  readonly ligada: boolean;
  readonly motivo: string | null;
}

export interface DependenciasSegredos {
  readonly porta: PortaSegredos;
  readonly cofre: Cofre;
  readonly receita: (nome: string, hospital: string) => EstadoReceita;
  /** Sistema anterior desligado (M58) e contingência (padrão aberta; falha fechada). */
  readonly situacao: (c: ContextoSegredos) => Promise<{ desligado: boolean; contingenciaAtiva: boolean }>;
  readonly agora?: () => number;
}

export interface AtorSegredos extends ContextoSegredos {
  readonly login: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

/** Regra 1: só depois do desligamento e com a contingência fechada. */
const contingenciaLigada = (s: { desligado: boolean; contingenciaAtiva: boolean }) =>
  s.contingenciaAtiva || !s.desligado;

const TEXTO_BLOQUEIO: Record<string, string> = {
  'contingencia-ativa':
    'O período de contingência do estabelecimento está aberto: o segredo antigo só sai depois do fim dele.',
  'operacao-desligada': 'A retirada ainda está desligada neste estabelecimento.',
  'cofre-indisponivel': 'O cofre de credenciais não está configurado neste servidor.',
  'falta-no-cofre':
    'Guarde antes no cofre a credencial que o sistema usa com o parceiro, para cada senha que ainda está na linha.',
  'rotacao-pendente':
    'A credencial guardada no cofre ainda é a mesma de antes: combine a troca com o parceiro e guarde a nova antes de retirar a antiga.',
  'sem-valor': 'Não há segredo guardado nesta linha.',
  'a-si-mesmo': 'Ninguém retira as próprias senhas secundárias.',
};

export class ServicoSegredos {
  constructor(private readonly d: DependenciasSegredos) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  /** Colunas com credencial do Sante no cofre (registro vivo e o arquivo do cofre existe). */
  private async noCofre(
    c: ContextoSegredos,
    tabela: string,
    chave: string,
    registros: readonly RegistroSegredoLido[],
  ): Promise<string[]> {
    if (!this.d.cofre.disponivel) return [];
    const r: string[] = [];
    for (const g of registros.filter((x) => x.tabela === tabela && x.chave === chave && !x.retiradoEm)) {
      const ref = referenciaDaColuna(c.hospital, tabela, chave, g.coluna);
      if (g.referencia === ref && (await this.d.cofre.existe(ref))) r.push(g.coluna);
    }
    return r;
  }

  async situacaoSegredos(c: ContextoSegredos): Promise<SegredosLegadoResposta> {
    const [lidos, sit] = await Promise.all([this.d.porta.lerSegredos(c), this.d.situacao(c)]);
    const receita = this.d.receita(OPERACAO_SEGREDO, c.hospital);
    const cond = {
      contingenciaLigada: contingenciaLigada(sit),
      receitaLigada: receita.ligada,
      cofreDisponivel: this.d.cofre.disponivel,
    };
    const linhas: LinhaSegredoLegado[] = [];
    const vistas = new Set<string>();
    for (const l of lidos.linhas) {
      vistas.add(`${l.tabela}\u0000${l.chave}`);
      const regs = lidos.registros.filter((r) => r.tabela === l.tabela && r.chave === l.chave);
      const noCofre = await this.noCofre(c, l.tabela, l.chave, lidos.registros);
      const rotacionadas = regs.filter((r) => !r.retiradoEm && r.rotacionado).map((r) => r.coluna);
      linhas.push({
        tabela: l.tabela,
        chave: l.chave,
        descricao: l.descricao,
        comValor: [...l.comValor],
        noCofre,
        rotacionadoEm: maisNova(regs.map((r) => r.rotacionadoEm)),
        retiradoEm: null,
        bloqueio: bloqueioRetiradaSegredo(
          { tabela: l.tabela, comValor: l.comValor, noCofre, rotacionadas },
          cond,
        ),
      });
    }
    // As já retiradas (sem valor na tabela) aparecem pelo registro, com a data da retirada.
    const retiradas = new Map<string, RegistroSegredoLido[]>();
    for (const r of lidos.registros) {
      const k = `${r.tabela}\u0000${r.chave}`;
      if (vistas.has(k) || !segredoCatalogado(r.tabela)) continue;
      retiradas.set(k, [...(retiradas.get(k) ?? []), r]);
    }
    for (const regs of retiradas.values()) {
      const r0 = regs[0]!;
      linhas.push({
        tabela: r0.tabela,
        chave: r0.chave,
        descricao: null,
        comValor: [],
        noCofre: await this.noCofre(
          c,
          r0.tabela,
          r0.chave,
          regs.map((r) => ({ ...r, retiradoEm: null })),
        ),
        rotacionadoEm: maisNova(regs.map((r) => r.rotacionadoEm)),
        retiradoEm: maisNova(regs.map((r) => r.retiradoEm)),
        bloqueio: 'sem-valor',
      });
    }
    const porChave = (tabela: string, f: (r: RegistroSegredoLido) => boolean) =>
      new Set(lidos.registros.filter((r) => r.tabela === tabela && f(r)).map((r) => r.chave)).size;
    return esquemaSegredosLegadoResposta.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      contingenciaLigada: cond.contingenciaLigada,
      cofreDisponivel: cond.cofreDisponivel,
      receita: { ligada: receita.ligada, motivo: receita.motivo },
      tabelas: SEGREDOS_LEGADO.map((s) => ({
        tabela: s.tabela,
        rotulo: s.rotulo,
        comValor: contagemProtegida(lidos.comValorPorTabela[s.tabela] ?? 0),
        noCofre: contagemProtegida(porChave(s.tabela, (r) => !r.retiradoEm)),
        rotacionados: contagemProtegida(porChave(s.tabela, (r) => r.rotacionado)),
        retirados: contagemProtegida(porChave(s.tabela, (r) => !!r.retiradoEm)),
      })),
      linhas: linhas.slice(0, TETO_LINHAS_SEGREDO),
      linhasTotal: linhas.length,
      excecoes: EXCECOES_SEGREDO_LEGADO.map((e) => ({ objeto: e.objeto, motivo: e.motivo })),
    });
  }

  /**
   * Guarda no cofre a credencial que o Sante usa com o parceiro para a coluna da linha (o valor nunca volta nem vai à
   * trilha) e registra a referência (SGH_INTG_SEGREDO_LEGADO, com a trilha). Não depende da contingência: guardar
   * não retira nada.
   */
  async guardar(
    a: AtorSegredos,
    p: { tabela: string; chave: string; coluna: string; valor: string; rotacionado: boolean },
  ): Promise<{ guardado: true; novo: boolean }> {
    const s = segredoCatalogado(p.tabela);
    if (!s || !s.colunas.includes(p.coluna))
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Coluna sem segredo catalogado.');
    if (!this.d.cofre.disponivel)
      throw new ErroProblema('indisponivel', 503, 'Cofre indisponível', TEXTO_BLOQUEIO['cofre-indisponivel']);
    const lidos = await this.d.porta.lerSegredos(a);
    const existe =
      lidos.linhas.some((l) => l.tabela === p.tabela && l.chave === p.chave) ||
      lidos.registros.some((r) => r.tabela === p.tabela && r.chave === p.chave);
    if (!existe)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Linha não encontrada',
        'A linha indicada não tem segredo.',
      );
    const colunaComValor = lidos.linhas.some(
      (l) => l.tabela === p.tabela && l.chave === p.chave && l.comValor.includes(p.coluna),
    );
    const referencia = referenciaDaColuna(a.hospital, p.tabela, p.chave, p.coluna);
    await this.d.cofre.gravar(referencia, p.valor);
    const r = await this.d.porta.registrarGuarda(
      a,
      {
        tabela: p.tabela,
        chave: p.chave,
        coluna: p.coluna,
        referencia,
        rotacionado: p.rotacionado,
        colunaComValor,
        usuario: a.login,
      },
      this.trilha(a, 'integracao.segredoLegado.guardado', 'integracao.segredoLegado', 'guardar'),
    );
    return { guardado: true, novo: r.novo };
  }

  /** Pré-condições da retirada do segredo antigo (regras 1 e 7), antes do executor (que confere de novo). */
  async conferirRetiradaSegredo(c: ContextoSegredos, tabela: string, chave: string): Promise<void> {
    const sit = await this.situacaoSegredos(c);
    const l = sit.linhas.find((x) => x.tabela === tabela && x.chave === chave);
    if (!l)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Linha não encontrada',
        'A linha indicada não tem segredo.',
      );
    if (l.bloqueio) throw recusa(l.bloqueio);
  }

  async senhasSecundarias(
    c: ContextoSegredos,
    f: { busca?: string; pagina: number },
    operador: string,
  ): Promise<SenhasSecundariasResposta> {
    const [lidas, sit] = await Promise.all([
      this.d.porta.lerSenhasSecundarias(c, { ...f, tamanho: TAMANHO_PAGINA_SENHA_SECUNDARIA }),
      this.d.situacao(c),
    ]);
    const receita = this.d.receita(OPERACAO_SENHA_SECUNDARIA, c.hospital);
    return esquemaSenhasSecundariasResposta.parse({
      hospital: c.hospital,
      contingenciaLigada: contingenciaLigada(sit),
      receita: { ligada: receita.ligada, motivo: receita.motivo },
      porColuna: Object.entries(lidas.porColuna).map(([coluna, n]) => ({
        coluna,
        usuarios: contagemProtegida(n),
      })),
      usuariosComSenha: contagemProtegida(lidas.usuariosComSenha),
      pagina: f.pagina,
      total: lidas.total,
      usuarios: lidas.usuarios.map((u) => ({
        login: u.login,
        colunas: u.colunas,
        proprio: u.login === operador,
      })),
    });
  }

  /** Pré-condições da retirada das senhas secundárias (o executor confere de novo, com o banco). */
  async conferirRetiradaSenhaSecundaria(c: ContextoSegredos, login: string, operador: string): Promise<void> {
    const sit = await this.d.situacao(c);
    const receita = this.d.receita(OPERACAO_SENHA_SECUNDARIA, c.hospital);
    const b = bloqueioRetiradaSenhaSecundaria(
      { login, colunas: ['SENHA_SEC', 'SENHA_CAN_NF'] },
      { contingenciaLigada: contingenciaLigada(sit), receitaLigada: receita.ligada, operador },
    );
    if (b) throw recusa(b, receita.motivo);
  }

  private trilha(a: AtorSegredos, evento: string, recurso: string, operacao: string): TrilhaSegredo {
    return {
      rede: a.rede,
      hospital: a.hospital,
      usuario: a.login,
      evento,
      recurso,
      operacao,
      resultado: 'sucesso',
      estacao: a.estacao,
      correlacao: a.correlacao,
    };
  }
}

function maisNova(ds: readonly (Date | null)[]): string | null {
  const t = ds.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return t.length > 0 ? new Date(Math.max(...t)).toISOString() : null;
}

function recusa(codigo: string, motivo: string | null = null): ErroProblema {
  const detalhe =
    codigo === 'operacao-desligada' && motivo
      ? `${TEXTO_BLOQUEIO[codigo]} ${motivo}`
      : TEXTO_BLOQUEIO[codigo];
  return new ErroProblema(
    codigo === 'operacao-desligada'
      ? 'operacao-bloqueada'
      : codigo === 'cofre-indisponivel'
        ? 'indisponivel'
        : 'recusa-de-negocio',
    codigo === 'cofre-indisponivel' ? 503 : 409,
    'Retirada indisponível',
    detalhe ?? codigo,
    { codigo },
  );
}
