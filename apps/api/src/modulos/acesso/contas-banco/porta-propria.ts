// M59-F1 (F2.2, lote 02-02): a porta PRÓPRIA do painel de contas do banco, sobre o MariaDB do cliente pelo @sgh/nucleo.
// Só lê o information_schema do banco do cliente (DATABASE()): os privilégios por tabela, por banco e globais de cada
// conta, contados por objeto; nenhum valor de linha, nenhuma senha. Conta fora da lista legível nunca volta pelo nome
// (sai no agregado, só contada).
// Melhoria: privilégio global ou do banco inteiro conta para cada tabela que alcança (a conta ampla não se esconde atrás
// de um GRANT ... ON banco.*).
// Melhoria: no banco próprio a exclusão é lógica (excluido_em) em todas as tabelas: qualquer DELETE concedido conta
// na imutabilidade, não só o de uma lista de tabelas clínicas.
// Limite: o information_schema mostra só o que a conta do núcleo enxerga (com GRANT OPTION ou como dona, tudo; sem, só
// os próprios privilégios). O painel diz isso no aviso do serviço.
import type { ContaBancoLida, PrivilegioReal } from '@sgh/contratos';
import type { ContasSgh } from '@sgh/dominio-acesso';
import type { Leitor } from '@sgh/nucleo';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoContasBanco, InventarioLido, PortaContasBanco } from './porta.js';

type Env = Readonly<Record<string, string | undefined>>;

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoContasBanco {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** As contas do Sante SGH no banco do cliente: a do núcleo (SGH_MARIADB_USUARIO; padrão root, só em dev). */
export function contasSghDoAmbiente(env: Env): ContasSgh {
  const conta = env['SGH_MARIADB_USUARIO']?.trim() || 'root';
  return { aplicacao: [conta], scripts: null, leitura: null };
}

/** Privilégios de cada conta sobre cada tabela-base do banco do cliente (tabela, banco e global). */
const PRIVILEGIOS = `
  SELECT p.GRANTEE AS titular, p.PRIVILEGE_TYPE AS acao, p.TABLE_NAME AS objeto FROM information_schema.TABLE_PRIVILEGES p
   WHERE p.TABLE_SCHEMA = DATABASE()
  UNION
  SELECT s.GRANTEE, s.PRIVILEGE_TYPE, t.TABLE_NAME FROM information_schema.SCHEMA_PRIVILEGES s
    JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_TYPE = 'BASE TABLE'
   WHERE s.TABLE_SCHEMA = DATABASE()
  UNION
  SELECT g.GRANTEE, g.PRIVILEGE_TYPE, t.TABLE_NAME FROM information_schema.USER_PRIVILEGES g
    JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
   WHERE g.PRIVILEGE_TYPE IN ('SELECT','INSERT','UPDATE','DELETE','REFERENCES','EXECUTE')`;

const LETRA: Readonly<Record<string, keyof ContaBancoLida['privilegios']>> = {
  SELECT: 'S',
  INSERT: 'I',
  UPDATE: 'U',
  DELETE: 'D',
  REFERENCES: 'R',
  EXECUTE: 'X',
};
const ACAO_MODULO = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE']);

/** "'conta'@'host'" → conta; "'papel'" (sem host) é papel. */
export function titularDoGrantee(grantee: string): { nome: string; papel: boolean } {
  const m = /^'((?:[^']|'')*)'(?:@'.*')?$/.exec(grantee.trim());
  const nome = (m?.[1] ?? grantee).replace(/''/g, "'");
  return { nome, papel: !grantee.includes('@') };
}

const legivel = (nome: string, l: { nomes: string[]; prefixos: string[] }): boolean => {
  const n = nome.toUpperCase();
  return l.nomes.includes(n) || l.prefixos.some((p) => n.startsWith(p.toUpperCase()));
};

type Privilegios = { -readonly [K in keyof ContaBancoLida['privilegios']]: ContaBancoLida['privilegios'][K] };
const zero = (): Privilegios => ({ S: 0, I: 0, U: 0, D: 0, R: 0, X: 0, M: 0 });

export class PortaContasBancoPropria implements PortaContasBanco {
  readonly destino = 'banco' as const;

  constructor(
    private readonly nucleo: NucleoContasBanco,
    private readonly cliente: string,
    private readonly contas: ContasSgh,
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'contas-banco' }, fn);
  }

  private privilegios(l: Leitor): Promise<{ titular: string; acao: string; objeto: string }[]> {
    return l.consultar<{ titular: string; acao: string; objeto: string }>(PRIVILEGIOS, [], {
      teto: 2_000_000,
    });
  }

  contasSgh(): ContasSgh {
    return this.contas;
  }

  modulosComConta(): readonly string[] {
    // A aplicação usa uma conta só no banco do cliente; as contas por módulo são do plano de privilégio mínimo.
    return [];
  }

  lerInventario(
    _c: ContextoContasBanco,
    legiveis: { nomes: string[]; prefixos: string[] },
  ): Promise<InventarioLido> {
    return this.ler(async (l) => {
      const porConta = new Map<
        string,
        { papel: boolean; acoes: Map<string, Set<string>>; escrita: Set<string> }
      >();
      for (const x of await this.privilegios(l)) {
        const t = titularDoGrantee(String(x.titular));
        const chave = `${t.papel ? 'p' : 'u'}:${t.nome}`;
        const c = porConta.get(chave) ?? { papel: t.papel, acoes: new Map(), escrita: new Set<string>() };
        porConta.set(chave, c);
        const acao = String(x.acao);
        if (!c.acoes.has(acao)) c.acoes.set(acao, new Set());
        c.acoes.get(acao)?.add(String(x.objeto));
        if (acao === 'INSERT' || acao === 'UPDATE' || acao === 'DELETE') c.escrita.add(String(x.objeto));
      }
      const contas: ContaBancoLida[] = [];
      const agregado = { quantidade: 0, privilegios: zero(), escrita: 0 };
      let loginsNaoLegiveis = 0;
      for (const [chave, c] of [...porConta].sort(([a], [b]) => a.localeCompare(b))) {
        const nome = chave.slice(2);
        const privilegios = zero();
        for (const [acao, objetos] of c.acoes) {
          const letra = LETRA[acao];
          if (letra) privilegios[letra] = objetos.size;
        }
        if (!legivel(nome, legiveis)) {
          agregado.quantidade += 1;
          for (const k of Object.keys(privilegios) as (keyof typeof privilegios)[])
            agregado.privilegios[k] += privilegios[k];
          agregado.escrita += c.escrita.size;
          if (!c.papel) loginsNaoLegiveis += 1;
          continue;
        }
        contas.push({
          nome,
          tipo: c.papel ? 'papel' : 'usuario',
          existeLogin: !c.papel,
          ativa: null,
          quantidade: 1,
          privilegios,
          objetosComEscrita: c.escrita.size,
          papeis: [],
        });
      }
      if (agregado.quantidade > 0)
        contas.push({
          nome: null,
          tipo: 'usuario',
          existeLogin: false,
          ativa: null,
          quantidade: agregado.quantidade,
          privilegios: agregado.privilegios,
          objetosComEscrita: agregado.escrita,
          papeis: [],
        });
      return { contas, loginsNaoLegiveis };
    });
  }

  lerPrivilegiosSgh(): Promise<readonly PrivilegioReal[]> {
    const minhas = new Set(this.contas.aplicacao.map((n) => n.toUpperCase()));
    return this.ler(async (l) =>
      (await this.privilegios(l))
        .map((x) => ({
          t: titularDoGrantee(String(x.titular)),
          acao: String(x.acao),
          objeto: String(x.objeto),
        }))
        .filter((x) => minhas.has(x.t.nome.toUpperCase()) && ACAO_MODULO.has(x.acao))
        .map((x) => ({ titular: x.t.nome, objeto: x.objeto, acao: x.acao as PrivilegioReal['acao'] })),
    );
  }

  lerDeleteClinico(_c: ContextoContasBanco, legiveis: { nomes: string[]; prefixos: string[] }) {
    return this.ler(async (l) => {
      const porTitular = new Map<string | null, Set<string>>();
      for (const x of await this.privilegios(l)) {
        if (String(x.acao) !== 'DELETE') continue;
        const nome = titularDoGrantee(String(x.titular)).nome;
        const chave = legivel(nome, legiveis) ? nome : null;
        if (!porTitular.has(chave)) porTitular.set(chave, new Set());
        porTitular.get(chave)?.add(String(x.objeto));
      }
      return [...porTitular].map(([titular, tabelas]) => ({ titular, tabelas: tabelas.size }));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contarTabelas(_c?: ContextoContasBanco): Promise<number> {
    return this.ler(async (l) =>
      Number(
        (
          await l.uma(
            "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
          )
        )?.['n'] ?? 0,
      ),
    );
  }
}

/** Sem o núcleo (e fora do ambiente sintético): o painel responde 503, nunca uma lista vazia enganosa. */
export function portaContasBancoIndisponivel(): PortaContasBanco {
  const fora = () =>
    Promise.reject(
      new ErroProblema('indisponivel', 503, 'Banco indisponível', 'O banco do cliente não está configurado.'),
    );
  return {
    destino: 'banco',
    contasSgh: () => ({ aplicacao: [], scripts: null, leitura: null }),
    modulosComConta: () => [],
    lerInventario: fora,
    lerPrivilegiosSgh: fora,
    lerDeleteClinico: fora,
    contarTabelas: fora,
  };
}
