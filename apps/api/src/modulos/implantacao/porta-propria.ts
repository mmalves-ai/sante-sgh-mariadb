// Porta própria da conferência da instalação e da fumaça (M60) sobre o banco do cliente, pelo @sgh/nucleo: leituras
// numa transação somente leitura do cliente da API. Lê a conexão corrente (versão, charset, conta e papel, cifra e
// compressão do canal, pelas variáveis de sessão do servidor), o registro das migrações aplicadas, o relógio do banco
// e a impressão da estrutura (tabelas e colunas do banco do cliente). Nada de senha, endereço nem dado de pessoa.
// Melhoria: o relógio vem em UTC (a sessão do núcleo é UTC): a fumaça compara só a deriva, sem depender do fuso do
// servidor do banco; a impressão da estrutura é calculada no próprio banco, sem a fonte de convivência antiga.
// Melhoria: o registro das migrações é lido só se a tabela existir (pedido de modelo `migracao_aplicada`); sem ela, a
// conferência diz que o banco não registra as migrações, em vez de inventar pendências.
import { createHash } from 'node:crypto';
import type { Leitor, NucleoProprio } from '@sgh/nucleo';
import type {
  ConexaoBanco,
  ContextoImplantacao,
  EstruturaBanco,
  MigracaoRegistrada,
  PortaImplantacao,
} from './porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoImplantacao = Pick<NucleoProprio, 'lerSomente'>;

type Linha = Record<string, unknown>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t === '' ? null : t;
};

/** A conta sem o host ("sgh_app@%" → "sgh_app"): o endereço não sai na resposta. */
export function contaSemHost(usuario: string): string {
  const i = usuario.lastIndexOf('@');
  return i < 0 ? usuario : usuario.slice(0, i);
}

/** SHA-256 das tabelas e colunas em ordem (tabela, coluna, tipo, nulo). */
export function resumoDaEstrutura(colunas: readonly Linha[]): string {
  const h = createHash('sha256');
  for (const c of colunas)
    h.update(`${texto(c['tabela'])}.${texto(c['coluna'])}:${texto(c['tipo'])}:${texto(c['nulo'])}\n`);
  return h.digest('hex');
}

export class PortaImplantacaoPropria implements PortaImplantacao {
  readonly destino = 'banco' as const;

  constructor(
    private readonly nucleo: NucleoImplantacao,
    private readonly cliente: string,
  ) {}

  private ler<T>(c: ContextoImplantacao, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: `implantacao-${c.hospital}`.slice(0, 64) }, fn);
  }

  conexao(c: ContextoImplantacao): Promise<ConexaoBanco> {
    return this.ler(c, async (l) => {
      const s = await l.uma<Linha>(
        `SELECT VERSION() AS versao, @@character_set_database AS charset_banco,
                @@character_set_connection AS charset_conexao, CURRENT_USER() AS conta, CURRENT_ROLE() AS papel,
                (SELECT VARIABLE_VALUE FROM information_schema.SESSION_STATUS WHERE VARIABLE_NAME = 'Ssl_cipher') AS cifra,
                (SELECT VARIABLE_VALUE FROM information_schema.SESSION_STATUS WHERE VARIABLE_NAME = 'Compression') AS compressao`,
        [],
      );
      // O plugin de autenticação da própria conta: sem o direito de ler o cadastro de contas, fica nulo.
      let autenticacao: string | null;
      try {
        const a = await l.uma<Linha>(
          `SELECT JSON_VALUE(Priv, '$.plugin') AS plugin FROM mysql.global_priv
            WHERE CONCAT(User, '@', Host) = CURRENT_USER()`,
          [],
        );
        autenticacao = textoOuNulo(a?.['plugin']);
      } catch {
        autenticacao = null;
      }
      const compressao = textoOuNulo(s?.['compressao']);
      return {
        versaoMotor: texto(s?.['versao']),
        charsetBanco: texto(s?.['charset_banco']),
        charsetConexao: textoOuNulo(s?.['charset_conexao']),
        autenticacao,
        canalCifrado: s ? textoOuNulo(s['cifra']) !== null : null,
        canalComprimido: compressao === null ? null : compressao.toUpperCase() === 'ON',
        protocolo: 'TCP',
        conta: contaSemHost(texto(s?.['conta'])),
        papel: textoOuNulo(s?.['papel']) === 'NONE' ? null : textoOuNulo(s?.['papel']),
      };
    });
  }

  migracoesRegistradas(c: ContextoImplantacao): Promise<MigracaoRegistrada[] | null> {
    return this.ler(c, async (l) => {
      const t = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'migracao_aplicada'`,
        [],
      );
      if (Number(t?.['n'] ?? 0) === 0) return null;
      const linhas = await l.consultar<Linha>('SELECT numero, hash FROM migracao_aplicada ORDER BY numero', [], {
        teto: 10_000,
      });
      return linhas.map((x) => ({ numero: Number(x['numero']), hash: texto(x['hash']) }));
    });
  }

  relogioBanco(c: ContextoImplantacao): Promise<string | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma<Linha>("SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f') AS agora", []);
      const v = textoOuNulo(r?.['agora']);
      return v ? v.slice(0, 23) : null;
    });
  }

  estrutura(c: ContextoImplantacao): Promise<EstruturaBanco> {
    return this.ler(c, async (l) => {
      const colunas = await l.consultar<Linha>(
        `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [],
        { teto: 200_000 },
      );
      return { resumo: resumoDaEstrutura(colunas), tabelas: new Set(colunas.map((x) => texto(x['tabela']))).size };
    });
  }
}
