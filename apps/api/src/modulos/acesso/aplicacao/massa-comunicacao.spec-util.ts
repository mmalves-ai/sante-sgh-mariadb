// Massa SINTÉTICA da comunicação interna (M27) no cliente de teste f22_o2 (onda 2): dois estabelecimentos, contas de
// serviço (sem dado de pessoa), vínculos vigentes, um perfil (grupo) e uma conta inativa. Idempotente (reaproveita o
// que existe); `limpar` apaga só o que a comunicação gravou nos estabelecimentos da massa. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { ContextoComunicacao, ContextoOperacaoComunicacao } from '../comunicacao-porta.js';
import { OPERACOES_DICIONARIO } from '../comunicacao-operacoes.js';

export const CLIENTE_COMUNICACAO = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

export interface MassaComunicacao {
  readonly nucleo: NucleoProprio;
  readonly estA: number;
  readonly estB: number;
  readonly codA: string;
  readonly codB: string;
  /** Logins e ids: remetente, dois destinatários do grupo, uma conta só do outro estabelecimento e uma inativa. */
  readonly login: { rem: string; d1: string; d2: string; outro: string; inativo: string };
  readonly id: { rem: number; d1: number; d2: number; outro: number; inativo: number };
  readonly grupo: string;
  ctx(quem: keyof MassaComunicacao['id'], est?: 'A' | 'B'): ContextoComunicacao;
  octx(quem: keyof MassaComunicacao['id'], chave: string): ContextoOperacaoComunicacao;
  ler<T extends Record<string, unknown>>(sql: string, p: readonly unknown[]): Promise<T[]>;
  limpar(): Promise<void>;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

export async function montarMassaComunicacao(sufixo: string): Promise<MassaComunicacao> {
  const nucleo = new NucleoProprio();
  await nucleo.cliente(CLIENTE_COMUNICACAO);
  const codA = `f2201${sufixo}a`;
  const codB = `f2201${sufixo}b`;
  const login = {
    rem: `f2201${sufixo}.rem`,
    d1: `f2201${sufixo}.d1`,
    d2: `f2201${sufixo}.d2`,
    outro: `f2201${sufixo}.outro`,
    inativo: `f2201${sufixo}.inativo`,
  };
  const grupo = `F2201${sufixo.toUpperCase()}`;
  const id = { rem: 0, d1: 0, d2: 0, outro: 0, inativo: 0 };
  let estA = 0;
  let estB = 0;
  await nucleo.escrever({ cliente: CLIENTE_COMUNICACAO, correlacao: `f2201-${sufixo}-massa` }, async (e) => {
    const agora = new Date();
    const est = (codigo: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [codigo],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
      );
    estA = await est(codA);
    estB = await est(codB);
    for (const k of Object.keys(login) as (keyof typeof login)[]) {
      id[k] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [login[k]],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [login[k], `Conta de teste ${k}`, agora],
      );
      await e.executar(
        "UPDATE usuario SET situacao = ?, expira_em = NULL, excluido_em = NULL WHERE id = ?",
        [k === 'inativo' ? 'inativo' : 'ativo', id[k]],
      );
      const vinculo = k === 'outro' ? estB : estA;
      await garantir(
        e,
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [id[k], vinculo],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [id[k], vinculo, '2020-01-01', agora],
      );
    }
    const perfil = await garantir(
      e,
      'SELECT id FROM perfil_acesso WHERE estabelecimento_id = ? AND codigo = ?',
      [estA, grupo],
      'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
      [estA, grupo, 'Grupo de teste da comunicação', agora],
    );
    for (const k of ['d1', 'd2', 'inativo'] as const)
      await garantir(
        e,
        'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?',
        [id[k], perfil],
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [id[k], perfil, estA, '2020-01-01', agora],
      );
  });
  const correlacao = `f2201-${sufixo}-${Date.now()}`;
  const ctx = (quem: keyof typeof id, qual: 'A' | 'B' = 'A'): ContextoComunicacao => ({
    cliente: CLIENTE_COMUNICACAO,
    estabelecimento: qual === 'A' ? estA : estB,
    usuario: id[quem],
    correlacao,
    rede: 'rede-teste',
    hospital: qual === 'A' ? codA : codB,
  });
  const usuarios = () => Object.values(id);
  return {
    nucleo,
    estA,
    estB,
    codA,
    codB,
    login,
    id,
    grupo,
    ctx,
    octx: (quem, chave) => ({ ...ctx(quem), chaveIdempotencia: chave, login: login[quem] }),
    ler: (sql, p) =>
      nucleo.lerSomente({ cliente: CLIENTE_COMUNICACAO, correlacao: 'f2201-conta' }, (l) => l.consultar(sql, p)),
    async limpar() {
      await nucleo.escrever({ cliente: CLIENTE_COMUNICACAO, correlacao: `f2201-${sufixo}-limpa` }, async (e) => {
        const ests = [estA, estB];
        const us = usuarios();
        const em = (xs: number[]) => xs.map(() => '?').join(', ');
        await e.executar(
          `DELETE ci FROM comunicado_ciencia ci JOIN comunicado k ON k.id = ci.comunicado_id WHERE k.estabelecimento_id IN (${em(ests)})`,
          ests,
        );
        await e.executar(
          `DELETE cd FROM comunicado_destinatario cd JOIN comunicado k ON k.id = cd.comunicado_id WHERE k.estabelecimento_id IN (${em(ests)})`,
          ests,
        );
        await e.executar(`DELETE FROM comunicado WHERE estabelecimento_id IN (${em(ests)})`, ests);
        await e.executar(
          `DELETE d FROM mensagem_interna_destinatario d JOIN mensagem_interna m ON m.id = d.mensagem_interna_id WHERE m.estabelecimento_id IN (${em(ests)})`,
          ests,
        );
        await e.executar(`DELETE FROM mensagem_interna WHERE estabelecimento_id IN (${em(ests)})`, ests);
        await e.executar(`DELETE FROM notificacao_usuario WHERE estabelecimento_id IN (${em(ests)})`, ests);
        await e.executar(`DELETE FROM dicionario_usuario WHERE usuario_id IN (${em(us)})`, us);
        await e.executar(
          `DELETE FROM idempotencia_operacao WHERE (operacao LIKE 'acesso.%' OR operacao IN (?, ?))
              AND estabelecimento_id IN (${em(ests)})`,
          [OPERACOES_DICIONARIO.incluir, OPERACOES_DICIONARIO.excluir, ...ests],
        );
      });
    },
  };
}
