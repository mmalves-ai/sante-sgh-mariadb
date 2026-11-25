// Porta própria da configuração do faturamento SUS (C1-051, 06-SUS linha 53) sobre o banco do cliente: a permissão
// por usuário e setor (permissao_setor_sus, já no modelo desde a 13_SUS/02) e os parâmetros próprios de cada instrumento
// (parametro_instrumento_sus, 13_SUS/95). Leitura pelo lerSomente; cada gravação é uma execução da operação
// `faturamento.sus.configuracao` no Executor (trilha e idempotência da execução). Nada é apagado: a permissão encerra
// pela vigência (excluido_em nunca é usado aqui) e o parâmetro sobe a versão.
import { randomUUID } from 'node:crypto';
import type { CamposParametroSus, InstrumentoParametroSus, TipoPermissaoSetorSus } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoSus } from './porta.js';
import type {
  GravacaoConfiguracaoSus,
  LeituraConfiguracaoSus,
  LinhaTrilhaConfiguracaoSus,
  NovaPermissaoSetorSus,
  ParametroInstrumentoSusRegistro,
  PermissaoSetorSusRegistro,
  PortaConfiguracaoSus,
} from './porta-configuracao.js';
import { ErroSus } from './tipos.js';

export type NucleoConfiguracaoSus = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TABELAS_CONFIGURACAO_SUS = ['permissao_setor_sus', 'parametro_instrumento_sus'] as const;

type Linha = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNulo = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
const dia = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;
const instante = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
const login = (col: string) => `(SELECT u.login FROM usuario u WHERE u.id = ${col})`;

const SQL_PERMISSOES = `SELECT p.id, p.usuario_id, u.login, u.nome AS usuario_nome, p.setor_funcional_id, s.nome AS setor_nome,
       p.tipo_permissao, ${dia('p.vigencia_inicio')} AS ini, ${dia('p.vigencia_fim')} AS fim,
       ${login('p.criado_por')} AS criado_por_login, ${instante('p.criado_em')} AS criado, p.versao
  FROM permissao_setor_sus p
  JOIN setor_funcional s ON s.id = p.setor_funcional_id
  JOIN usuario u ON u.id = p.usuario_id
 WHERE s.estabelecimento_id = ? AND p.excluido_em IS NULL`;

const SQL_PARAMETROS = `SELECT instrumento, fonte_padrao, orgao_origem, sigla_origem, cnpj_prestador, orgao_destino,
       indicador_destino, uf, uti_por_acomodacao, diretor_clinico_cns, versao,
       ${login('COALESCE(alterado_por, criado_por)')} AS por, ${instante('COALESCE(alterado_em, criado_em)')} AS em
  FROM parametro_instrumento_sus WHERE estabelecimento_id = ? ORDER BY FIELD(instrumento, 'ciha', 'bpa', 'apac', 'aih')`;

function permissaoDa(r: Linha): PermissaoSetorSusRegistro {
  return {
    id: num(r['id']),
    usuario: num(r['usuario_id']),
    usuarioLogin: txt(r['login']),
    usuarioNome: txt(r['usuario_nome']),
    setor: num(r['setor_funcional_id']),
    setorNome: txt(r['setor_nome']),
    tipo: txt(r['tipo_permissao']) as TipoPermissaoSetorSus,
    vigenciaInicio: txt(r['ini']),
    vigenciaFim: txtOuNulo(r['fim']),
    criadoPor: txtOuNulo(r['criado_por_login']),
    criadoEm: txt(r['criado']),
    versao: num(r['versao']),
  };
}

function parametroDa(r: Linha): ParametroInstrumentoSusRegistro {
  return {
    instrumento: txt(r['instrumento']) as InstrumentoParametroSus,
    campos: {
      fontePadrao: txtOuNulo(r['fonte_padrao']) as CamposParametroSus['fontePadrao'],
      orgaoOrigem: txtOuNulo(r['orgao_origem']),
      siglaOrigem: txtOuNulo(r['sigla_origem']),
      cnpjPrestador: txtOuNulo(r['cnpj_prestador']),
      orgaoDestino: txtOuNulo(r['orgao_destino']),
      indicadorDestino: txtOuNulo(r['indicador_destino']) as CamposParametroSus['indicadorDestino'],
      uf: txtOuNulo(r['uf']),
      utiPorAcomodacao: txtOuNulo(r['uti_por_acomodacao']),
      diretorClinicoCns: txtOuNulo(r['diretor_clinico_cns']),
    },
    versao: num(r['versao']),
    alteradoPor: txtOuNulo(r['por']),
    alteradoEm: txt(r['em']),
  };
}

class LeituraConfiguracaoSusPropria implements LeituraConfiguracaoSus {
  constructor(
    protected readonly l: Leitor,
    protected readonly est: number,
  ) {}

  async permissoes(usuario?: number): Promise<PermissaoSetorSusRegistro[]> {
    const filtro = usuario === undefined ? '' : ' AND p.usuario_id = ?';
    const ls = await this.l.consultar<Linha>(
      `${SQL_PERMISSOES}${filtro} ORDER BY u.nome, s.nome, p.vigencia_inicio`,
      [this.est, ...(usuario === undefined ? [] : [usuario])],
    );
    return ls.map(permissaoDa);
  }

  async parametros(): Promise<ParametroInstrumentoSusRegistro[]> {
    return (await this.l.consultar<Linha>(SQL_PARAMETROS, [this.est])).map(parametroDa);
  }

  async setores(): Promise<{ id: number; nome: string }[]> {
    const ls = await this.l.consultar<Linha>(
      'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
      [this.est],
    );
    return ls.map((r) => ({ id: num(r['id']), nome: txt(r['nome']) }));
  }

  async usuarios(): Promise<{ id: number; login: string; nome: string }[]> {
    const ls = await this.l.consultar<Linha>(
      `SELECT id, login, nome FROM usuario
        WHERE situacao = 'ativo' AND tipo_conta = 'pessoa' AND excluido_em IS NULL ORDER BY nome LIMIT 2000`,
      [],
    );
    return ls.map((r) => ({ id: num(r['id']), login: txt(r['login']), nome: txt(r['nome']) }));
  }
}

class GravacaoConfiguracaoSusPropria
  extends LeituraConfiguracaoSusPropria
  implements GravacaoConfiguracaoSus
{
  readonly linhas: LinhaTrilhaConfiguracaoSus[] = [];

  constructor(
    private readonly tx: TxOperacao,
    est: number,
    private readonly usuario: number | null,
  ) {
    super(tx, est);
  }

  async setorDoEstabelecimento(id: number): Promise<boolean> {
    const r = await this.tx.uma<Linha>(
      'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
      [id, this.est],
    );
    return r !== null && r !== undefined;
  }

  async usuarioAtivo(id: number): Promise<boolean> {
    const r = await this.tx.uma<Linha>(
      "SELECT id FROM usuario WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [id],
    );
    return r !== null && r !== undefined;
  }

  async permissao(id: number): Promise<PermissaoSetorSusRegistro | null> {
    const [r] = await this.tx.consultarParaAtualizar<Linha>(`${SQL_PERMISSOES} AND p.id = ?`, [this.est, id]);
    return r ? permissaoDa(r) : null;
  }

  async incluirPermissao(n: NovaPermissaoSetorSus): Promise<number> {
    return this.tx.inserir(
      `INSERT INTO permissao_setor_sus (usuario_id, setor_funcional_id, tipo_permissao, vigencia_inicio, vigencia_fim,
                                        criado_em, criado_por, versao)
       VALUES (?, ?, ?, ?, ?, NOW(3), ?, 1)`,
      [n.usuario, n.setor, n.tipo, n.vigenciaInicio, n.vigenciaFim, this.usuario],
    );
  }

  async encerrarPermissao(id: number, vigenciaFim: string, versao: number): Promise<boolean> {
    const r = await this.tx.executar(
      `UPDATE permissao_setor_sus SET vigencia_fim = ?, alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
        WHERE id = ? AND versao = ? AND excluido_em IS NULL`,
      [vigenciaFim, this.usuario, id, versao],
    );
    return r === 1;
  }

  async gravarParametros(
    instrumento: InstrumentoParametroSus,
    c: CamposParametroSus,
    versao: number | null,
  ): Promise<boolean> {
    const valores = [
      c.fontePadrao,
      c.orgaoOrigem,
      c.siglaOrigem,
      c.cnpjPrestador,
      c.orgaoDestino,
      c.indicadorDestino,
      c.uf,
      c.utiPorAcomodacao,
      c.diretorClinicoCns,
    ];
    const [atual] = await this.tx.consultarParaAtualizar<Linha>(
      'SELECT versao FROM parametro_instrumento_sus WHERE estabelecimento_id = ? AND instrumento = ?',
      [this.est, instrumento],
    );
    if ((atual ? num(atual['versao']) : null) !== versao) return false;
    if (!atual) {
      await this.tx.inserir(
        `INSERT INTO parametro_instrumento_sus (estabelecimento_id, instrumento, fonte_padrao, orgao_origem, sigla_origem,
           cnpj_prestador, orgao_destino, indicador_destino, uf, uti_por_acomodacao, diretor_clinico_cns, criado_em,
           criado_por, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, 1)`,
        [this.est, instrumento, ...valores, this.usuario],
      );
      return true;
    }
    await this.tx.executar(
      `UPDATE parametro_instrumento_sus SET fonte_padrao = ?, orgao_origem = ?, sigla_origem = ?, cnpj_prestador = ?,
              orgao_destino = ?, indicador_destino = ?, uf = ?, uti_por_acomodacao = ?, diretor_clinico_cns = ?,
              alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
        WHERE estabelecimento_id = ? AND instrumento = ? AND versao = ?`,
      [...valores, this.usuario, this.est, instrumento, versao],
    );
    return true;
  }

  trilha(l: LinhaTrilhaConfiguracaoSus): void {
    this.linhas.push(l);
  }
}

export class PortaConfiguracaoSusPropria implements PortaConfiguracaoSus {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoConfiguracaoSus,
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoSus, est: number | null): ContextoNucleo {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario ?? null,
      correlacao: (c.correlacao || `sus-cfg-${c.hospital}`).slice(0, 64),
    };
  }

  private async estabelecimento(c: ContextoSus): Promise<number> {
    if (c.estabelecimento) return c.estabelecimento;
    const r = await this.nucleo.lerSomente(this.contexto(c, null), (l) =>
      l.uma<Linha>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [c.hospital]),
    );
    if (r) return num(r['id']);
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  }

  async ler<T>(c: ContextoSus, fn: (l: LeituraConfiguracaoSus) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) =>
      fn(new LeituraConfiguracaoSusPropria(l, est)),
    );
  }

  async gravar<T>(c: ContextoSus, fn: (g: GravacaoConfiguracaoSus) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    let saida: { valor: T } | null = null;
    let linhas: readonly LinhaTrilhaConfiguracaoSus[] = [];
    let recusada: Error | null = null;
    const usuario = c.usuario ?? null;
    const op = definirOperacao({
      nome: 'faturamento.sus.configuracao',
      tabelas: [...TABELAS_CONFIGURACAO_SUS],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const g = new GravacaoConfiguracaoSusPropria(tx, est, usuario);
        try {
          saida = { valor: await fn(g) };
        } catch (erro) {
          if (erro instanceof ErroSus || erro instanceof ErroProblema) recusada = erro;
          throw erro;
        }
        linhas = g.linhas;
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linhas[linhas.length - 1];
        const id = l?.id && /^\d{1,15}$/.test(l.id) ? Number(l.id) : null;
        return { tabela: l?.tabela ?? 'permissao_setor_sus', id };
      },
      trilha: () => ({ dados: { eventos: linhas.map((l) => ({ ...l })) } }),
    });
    const chave = `sus-cfg:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    try {
      await this.executor.executar(op, this.cliente, { chave }, ctx);
    } catch (erro) {
      if (recusada) throw recusada;
      throw erro;
    }
    if (!saida) throw new Error('Gravação da configuração do faturamento SUS sem resultado.');
    return (saida as { valor: T }).valor;
  }
}
