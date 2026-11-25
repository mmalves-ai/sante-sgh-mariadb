// Porta da configuração do faturamento SUS (C1-051, 06-SUS linha 53): a permissão por usuário e setor
// (permissao_setor_sus) e os parâmetros próprios de cada instrumento (parametro_instrumento_sus). A própria fala com o
// banco do cliente (porta-configuracao-propria.ts); a memória serve ao dev/ci sem núcleo e aos testes do serviço.
// Nada é apagado: a permissão encerra pela vigência; o parâmetro sobe a versão.
import type { CamposParametroSus, InstrumentoParametroSus, TipoPermissaoSetorSus } from '@sgh/contratos';
import type { ContextoSus } from './porta.js';

export const PORTA_CONFIGURACAO_SUS = Symbol('PORTA_CONFIGURACAO_SUS');

export interface PermissaoSetorSusRegistro {
  readonly id: number;
  readonly usuario: number;
  readonly usuarioLogin: string;
  readonly usuarioNome: string;
  readonly setor: number;
  readonly setorNome: string;
  readonly tipo: TipoPermissaoSetorSus;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly criadoPor: string | null;
  readonly criadoEm: string;
  readonly versao: number;
}

export interface ParametroInstrumentoSusRegistro {
  readonly instrumento: InstrumentoParametroSus;
  readonly campos: CamposParametroSus;
  readonly versao: number;
  readonly alteradoPor: string | null;
  readonly alteradoEm: string;
}

export interface NovaPermissaoSetorSus {
  readonly usuario: number;
  readonly setor: number;
  readonly tipo: TipoPermissaoSetorSus;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** A linha da trilha de uma gravação da configuração (sem dado pessoal: ids, tipo, vigência, campos mudados). */
export interface LinhaTrilhaConfiguracaoSus {
  readonly evento: string;
  readonly operacao: string;
  readonly tabela: string;
  readonly id: string;
  readonly diferenca: string;
}

export interface LeituraConfiguracaoSus {
  /** As permissões do estabelecimento (todas, vigentes ou não; do usuário quando informado). */
  permissoes(usuario?: number): Promise<PermissaoSetorSusRegistro[]>;
  parametros(): Promise<ParametroInstrumentoSusRegistro[]>;
  setores(): Promise<{ id: number; nome: string }[]>;
  usuarios(): Promise<{ id: number; login: string; nome: string }[]>;
}

export interface GravacaoConfiguracaoSus extends LeituraConfiguracaoSus {
  setorDoEstabelecimento(id: number): Promise<boolean>;
  usuarioAtivo(id: number): Promise<boolean>;
  permissao(id: number): Promise<PermissaoSetorSusRegistro | null>;
  incluirPermissao(n: NovaPermissaoSetorSus): Promise<number>;
  /** Encerra na versão vista; false: a versão mudou. */
  encerrarPermissao(id: number, vigenciaFim: string, versao: number): Promise<boolean>;
  /** Grava (insere na primeira vez, versão null) na versão vista; false: a versão mudou. */
  gravarParametros(
    instrumento: InstrumentoParametroSus,
    campos: CamposParametroSus,
    versao: number | null,
  ): Promise<boolean>;
  trilha(l: LinhaTrilhaConfiguracaoSus): void;
}

export interface PortaConfiguracaoSus {
  readonly destino: 'banco' | 'memoria';
  ler<T>(c: ContextoSus, fn: (l: LeituraConfiguracaoSus) => Promise<T>): Promise<T>;
  gravar<T>(c: ContextoSus, fn: (g: GravacaoConfiguracaoSus) => Promise<T>): Promise<T>;
}

/** Memória (dev/ci sem núcleo e testes): um estabelecimento por hospital, setores e usuários sintéticos. */
export class PortaConfiguracaoSusMemoria implements PortaConfiguracaoSus {
  readonly destino = 'memoria' as const;
  readonly permissoesGravadas: (PermissaoSetorSusRegistro & { hospital: string })[] = [];
  readonly parametrosGravados: (ParametroInstrumentoSusRegistro & { hospital: string })[] = [];
  readonly trilhas: LinhaTrilhaConfiguracaoSus[] = [];
  private seq = 0;

  constructor(
    readonly setoresSinteticos: readonly { id: number; nome: string }[] = [
      { id: 1, nome: 'Ambulatório' },
      { id: 2, nome: 'Internação' },
    ],
    readonly usuariosSinteticos: readonly { id: number; login: string; nome: string }[] = [
      { id: 1, login: 'FATURISTA.SINT', nome: 'Faturista sintético' },
    ],
  ) {}

  private leitura(hospital: string): LeituraConfiguracaoSus {
    return {
      permissoes: async (usuario) =>
        this.permissoesGravadas.filter(
          (p) => p.hospital === hospital && (usuario === undefined || p.usuario === usuario),
        ),
      parametros: async () => this.parametrosGravados.filter((p) => p.hospital === hospital),
      setores: async () => [...this.setoresSinteticos],
      usuarios: async () => [...this.usuariosSinteticos],
    };
  }

  async ler<T>(c: ContextoSus, fn: (l: LeituraConfiguracaoSus) => Promise<T>): Promise<T> {
    return fn(this.leitura(c.hospital));
  }

  async gravar<T>(c: ContextoSus, fn: (g: GravacaoConfiguracaoSus) => Promise<T>): Promise<T> {
    const h = c.hospital;
    const agora = new Date().toISOString();
    const linhas: LinhaTrilhaConfiguracaoSus[] = [];
    const g: GravacaoConfiguracaoSus = {
      ...this.leitura(h),
      setorDoEstabelecimento: async (id) => this.setoresSinteticos.some((s) => s.id === id),
      usuarioAtivo: async (id) => this.usuariosSinteticos.some((u) => u.id === id),
      permissao: async (id) => this.permissoesGravadas.find((p) => p.hospital === h && p.id === id) ?? null,
      incluirPermissao: async (n) => {
        const u = this.usuariosSinteticos.find((x) => x.id === n.usuario);
        const s = this.setoresSinteticos.find((x) => x.id === n.setor);
        const id = ++this.seq;
        this.permissoesGravadas.push({
          ...n,
          hospital: h,
          id,
          usuarioLogin: u?.login ?? '',
          usuarioNome: u?.nome ?? '',
          setorNome: s?.nome ?? '',
          criadoPor: c.usuario ? String(c.usuario) : null,
          criadoEm: agora,
          versao: 1,
        });
        return id;
      },
      encerrarPermissao: async (id, fim, versao) => {
        const i = this.permissoesGravadas.findIndex((p) => p.hospital === h && p.id === id);
        const p = this.permissoesGravadas[i];
        if (!p || p.versao !== versao) return false;
        this.permissoesGravadas[i] = { ...p, vigenciaFim: fim, versao: p.versao + 1 };
        return true;
      },
      gravarParametros: async (instrumento, campos, versao) => {
        const i = this.parametrosGravados.findIndex((p) => p.hospital === h && p.instrumento === instrumento);
        const p = this.parametrosGravados[i];
        if ((p ? p.versao : null) !== versao) return false;
        const novo = {
          hospital: h,
          instrumento,
          campos,
          versao: (p?.versao ?? 0) + 1,
          alteradoPor: c.usuario ? String(c.usuario) : null,
          alteradoEm: agora,
        };
        if (p) this.parametrosGravados[i] = novo;
        else this.parametrosGravados.push(novo);
        return true;
      },
      trilha: (l) => linhas.push(l),
    };
    const r = await fn(g);
    this.trilhas.push(...linhas);
    return r;
  }
}
