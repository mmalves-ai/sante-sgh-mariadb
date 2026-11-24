// pnpm plataforma:criar-admin -- --email <e-mail> --nome "<nome>"
//
// Inicialização da plataforma (ADR 0021): cria a PRIMEIRA conta da plataforma (papel plataforma) no banco plataforma,
// sem senha e com convite, e envia o convite por e-mail. Quem define a senha é a própria pessoa, pela tela do convite
// (/plataforma/convite); o segundo fator é cadastrado no primeiro login fora de dev/ci.
//
// - Convite igual ao da API: o mesmo token e resumo (novoConvite, SHA-256 do token) e a mesma validade (72 horas,
//   CONVITE_HORAS do serviço da plataforma; o teste confere).
// - Auditoria: evento em conta_plataforma_evento com o ator nulo (inicialização, sem conta que agiu), a estação
//   TERMINAL e o motivo no detalhe; a conta fica com criado_por nulo.
// - Envio pelo MESMO caminho da API: emailAcessoDoAmbiente (SMTP_URL; fora de produção, só a captura local em
//   loopback). Sem envio configurado, recusa antes de gravar.
// Travas:
// - recusa em produção (AMBIENTE=producao): lá a primeira conta é do procedimento de implantação;
// - recusa se já houver conta da plataforma ATIVA com senha (o comando é só a inicialização; o resto é pela tela);
// - a conta do e-mail já existe sem senha (convite não aceito ou vencido): gera convite novo e reenvia;
// - a conta do e-mail existe com senha, ou é do suporte técnico: recusa.
// Nunca imprime link, token ou senha: só "convite enviado para <e-mail>".
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { novoConvite } from '@sgh/dominio-acesso';
import { type Ambiente, type Escritor, NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import {
  ENDERECO_EMAIL,
  emailAcessoDoAmbiente,
  type MensagemAcesso,
  type PortaEmailAcesso,
} from '../../apps/api/src/sessao/email-acesso.ts';

/** Validade do convite, em horas (a mesma do serviço da plataforma, CONVITE_HORAS). */
export const CONVITE_HORAS_INICIAL = 72;
/** Evento de criação da conta (o mesmo código do catálogo de auditoria usado pela API para criar conta). */
export const EVENTO_CRIADA = 'suporte.conta.criada';
/** Evento do convite reemitido (o mesmo da API). */
export const EVENTO_CONVITE = 'suporte.convite.gerado';
export const ESTACAO_TERMINAL = 'TERMINAL';
export const MOTIVO_INICIALIZACAO = 'inicializacao-da-plataforma';

// eslint-disable-next-line no-control-regex -- recusa de caracteres de controle é a intenção
const CONTROLE = /[\u0000-\u001f\u007f]/;

export interface PedidoAdmin {
  readonly email: string;
  readonly nome: string;
}

/** --email e --nome (com "=" ou separados). Recusa sem citar o valor. */
export function analisarArgumentos(argv: readonly string[]): PedidoAdmin {
  const valores: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--') continue;
    const m = /^--(email|nome)(?:=(.*))?$/s.exec(a);
    if (!m) throw new Error(`argumento desconhecido (use --email e --nome)`);
    const chave = m[1] as 'email' | 'nome';
    if (m[2] !== undefined) valores[chave] = m[2];
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${chave} sem valor`);
      valores[chave] = v;
      i++;
    }
  }
  const email = (valores['email'] ?? '').trim().toLowerCase();
  const nome = (valores['nome'] ?? '').trim();
  if (!email) throw new Error('--email é obrigatório');
  if (!ENDERECO_EMAIL.test(email) || email.length > 254) throw new Error('--email fora do formato');
  if (!nome) throw new Error('--nome é obrigatório');
  if (nome.length > 120 || CONTROLE.test(nome)) throw new Error('--nome fora do formato');
  return { email, nome };
}

/** O que o banco diz antes de gravar (lido na mesma transação, com as linhas travadas). */
export interface EstadoContas {
  /** Contas da plataforma ativas e com senha definida. */
  readonly plataformaAtivasComSenha: number;
  /** A conta do e-mail pedido, se existir. */
  readonly contaDoEmail: { readonly id: number; readonly papel: string; readonly comSenha: boolean } | null;
}

export type Decisao =
  | { readonly acao: 'criar' }
  | { readonly acao: 'reconvidar'; readonly id: number }
  | { readonly acao: 'recusar'; readonly motivo: string };

export function decidir(e: EstadoContas): Decisao {
  if (e.plataformaAtivasComSenha > 0)
    return {
      acao: 'recusar',
      motivo:
        'já existe conta da plataforma ativa com senha: este comando é só a inicialização (use a tela da plataforma)',
    };
  const c = e.contaDoEmail;
  if (!c) return { acao: 'criar' };
  if (c.papel !== 'plataforma')
    return { acao: 'recusar', motivo: 'o e-mail é de uma conta do suporte técnico' };
  if (c.comSenha) return { acao: 'recusar', motivo: 'a conta deste e-mail já tem senha' };
  return { acao: 'reconvidar', id: c.id };
}

export function ehProducao(env: Ambiente): boolean {
  return (env['AMBIENTE'] ?? 'dev').trim() === 'producao';
}

/** O endereço público da tela (a mesma regra da API: WEB_ENDERECO, senão o loopback na WEB_PORTA). */
export function enderecoWeb(env: Ambiente): string {
  return (env['WEB_ENDERECO']?.trim() || `http://127.0.0.1:${env['WEB_PORTA']?.trim() || '5300'}`).replace(
    /\/+$/,
    '',
  );
}

export function mensagemConvite(
  p: PedidoAdmin,
  link: string,
  ate: Date,
): { para: string; assunto: string; texto: string } {
  return {
    para: p.email,
    assunto: 'Convite para administrar a plataforma',
    texto:
      `Olá, ${p.nome}.\n\n` +
      'Você foi cadastrado(a) como administrador(a) da plataforma. Para definir a sua senha, abra:\n' +
      `${link}\n\n` +
      `O convite vale até ${ate.toISOString().replace('T', ' ').slice(0, 16)} (UTC), por ${CONVITE_HORAS_INICIAL} ` +
      'horas, e uma vez só. Fora do ambiente de desenvolvimento, o segundo fator é cadastrado no primeiro acesso.\n' +
      'Se você não esperava este convite, ignore este e-mail.\n',
  };
}

/** Grava a conta (ou o convite novo) numa transação. Devolve a decisão tomada. */
export async function gravar(
  w: Escritor,
  p: PedidoAdmin,
  conviteHash: string,
  ate: Date,
  agora: Date,
): Promise<Decisao> {
  const ativas = await w.consultarParaAtualizar(
    `SELECT id FROM conta_plataforma WHERE papel = 'plataforma' AND ativo AND resumo_senha IS NOT NULL`,
  );
  const doEmail = await w.consultarParaAtualizar(
    'SELECT id, papel, resumo_senha IS NOT NULL AS com_senha FROM conta_plataforma WHERE email = ?',
    [p.email],
  );
  const l = doEmail[0];
  const decisao = decidir({
    plataformaAtivasComSenha: ativas.length,
    contaDoEmail: l
      ? { id: Number(l['id']), papel: String(l['papel']), comSenha: Number(l['com_senha']) === 1 }
      : null,
  });
  const detalhe = JSON.stringify({ motivo: MOTIVO_INICIALIZACAO, papel: 'plataforma' });
  const evento = (codigo: string, alvo: number) =>
    w.inserir(
      `INSERT INTO conta_plataforma_evento
         (ator_conta_id, evento, conta_alvo_id, detalhe, estacao, ocorrido_em, criado_em, criado_por)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, NULL)`,
      [codigo, alvo, detalhe, ESTACAO_TERMINAL, agora, agora],
    );
  if (decisao.acao === 'criar') {
    const id = await w.inserir(
      `INSERT INTO conta_plataforma
         (email, nome, papel, ativo, resumo_senha, convite_resumo, convite_valido_ate, criado_em, criado_por)
       VALUES (?, ?, 'plataforma', TRUE, NULL, ?, ?, ?, NULL)`,
      [p.email, p.nome, conviteHash, ate, agora],
    );
    await evento(EVENTO_CRIADA, id);
  } else if (decisao.acao === 'reconvidar') {
    const n = await w.executar(
      `UPDATE conta_plataforma
          SET convite_resumo = ?, convite_valido_ate = ?, segredo_segundo_fator = NULL, segundo_fator_ativo = FALSE,
              ativo = TRUE, alterado_em = ?, alterado_por = NULL, versao = versao + 1
        WHERE id = ? AND resumo_senha IS NULL`,
      [conviteHash, ate, agora, decisao.id],
    );
    if (n !== 1) throw new Error('conta_plataforma: convite não regravado');
    await evento(EVENTO_CONVITE, decisao.id);
  }
  return decisao;
}

export interface Dependencias {
  readonly env: Ambiente;
  readonly email: PortaEmailAcesso | null;
  /** Transação no banco plataforma. */
  readonly escrever: <T>(fn: (w: Escritor) => Promise<T>) => Promise<T>;
  readonly agora?: () => Date;
  readonly saida?: (linha: string) => void;
}

/** O comando sem o processo (os testes trocam o banco e o envio). Lança com a recusa; nunca com token ou senha. */
export async function executar(argv: readonly string[], d: Dependencias): Promise<Decisao> {
  if (ehProducao(d.env))
    throw new Error('recusado em produção: a primeira conta é do procedimento de implantação');
  const p = analisarArgumentos(argv);
  if (!d.email) throw new Error('envio de e-mail não configurado (SMTP_URL): nada foi gravado');
  const agora = (d.agora ?? (() => new Date()))();
  const ate = new Date(agora.getTime() + CONVITE_HORAS_INICIAL * 3600_000);
  const cv = novoConvite();
  const decisao = await d.escrever((w) => gravar(w, p, cv.hash, ate, agora));
  if (decisao.acao === 'recusar') throw new Error(`recusado: ${decisao.motivo}`);
  const link = `${enderecoWeb(d.env)}/plataforma/convite?token=${encodeURIComponent(cv.token)}`;
  await d.email.enviar(mensagemConvite(p, link, ate));
  (d.saida ?? console.log)(`convite enviado para ${p.email}`);
  return decisao;
}

/** E-mail do dono (canal de avisos da obra): DONO_EMAIL do ambiente, senão o endereço padrão do avisar_dono.py. */
export function emailDoDono(env: Ambiente): string {
  return (env['DONO_EMAIL']?.trim() || 'mmalves@hal-ai.com').toLowerCase();
}

/**
 * Entrega pelo canal de avisos da obra (decisão do dono, 24/11/2026): o convite da conta do PRÓPRIO dono vai à caixa
 * real dele por tools/obra/avisar_dono.py (SES), também fora de produção. Só para o e-mail do dono; o texto (com o
 * link) passa por arquivo temporário 0600, apagado no fim, nunca por argumento de processo, saída ou log.
 */
export function envioPeloCanalDoDono(env: Ambiente, raiz: string): PortaEmailAcesso {
  return {
    destino: 'smtp',
    async enviar(m: MensagemAcesso) {
      if (m.para.toLowerCase() !== emailDoDono(env))
        throw new Error('recusado: o canal do dono só entrega ao e-mail do dono');
      const dir = mkdtempSync(join(tmpdir(), 'convite-'));
      const arq = join(dir, 'convite.txt');
      try {
        writeFileSync(arq, m.texto, { mode: 0o600 });
        execFileSync(
          'python3',
          ['-I', join(raiz, 'tools/obra/avisar_dono.py'), '--assunto', m.assunto, '--arquivo', arq, '--para', m.para],
          { stdio: ['ignore', 'ignore', 'inherit'] },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

async function principal(argvBruto: readonly string[]): Promise<number> {
  const { env } = ambienteEfetivo();
  if (ehProducao(env))
    throw new Error('recusado em produção: a primeira conta é do procedimento de implantação');
  const peloDono = argvBruto.includes('--entregar-ao-dono');
  // --endereco=<url>: só o endereço do link do convite (a tela que o dono abre, ex.: o IP da VM em dev); não passa
  // pela neutralização do ambiente, que recusa WEB_ENDERECO fora do loopback para as integrações.
  const endereco = argvBruto.find((a) => a.startsWith('--endereco='))?.slice('--endereco='.length);
  if (endereco !== undefined && !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(endereco))
    throw new Error('recusado: --endereco fora do formato http(s)://host[:porta]');
  const argv = argvBruto.filter((a) => a !== '--entregar-ao-dono' && !a.startsWith('--endereco='));
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const nucleo = new NucleoProprio({ env });
  try {
    await executar(argv, {
      env: endereco ? { ...env, WEB_ENDERECO: endereco } : env,
      email: peloDono ? envioPeloCanalDoDono(env, raiz) : emailAcessoDoAmbiente(env as NodeJS.ProcessEnv),
      escrever: (fn) => nucleo.escreverPlataforma('plataforma-criar-admin', fn),
    });
  } finally {
    await nucleo.encerrar();
  }
  return 0;
}

if ((import.meta as { main?: boolean }).main) {
  principal(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      // Recusas do comando são textos próprios (sem valor); erro de banco ou SMTP pode trazer valor: só nome e código.
      const m = e instanceof Error ? e.message : '';
      const codigo = (e as { code?: unknown } | null)?.code;
      console.error(
        /^(recusado|envio de e-mail|--|argumento desconhecido)/.test(m) ||
          (e instanceof Error && e.name === 'ErroConfiguracao') // cita a chave, nunca o valor
          ? m
          : `falhou: ${e instanceof Error ? e.name : 'erro'} ${String(codigo ?? '')}`,
      );
      process.exit(1);
    },
  );
}
