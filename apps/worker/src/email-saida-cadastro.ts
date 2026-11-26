// Envio pelo cadastro do cliente (01-ADM L77, C1-063), para as saídas fora da fila de alertas (relatório agendado,
// aviso do sistema): com a saída lida (email-saida-propria.ts), monta a conexão pela regra do domínio (conexaoDaSaida:
// fora de produção sempre a captura local, sem senha; em produção o servidor cadastrado), lê a senha no cofre pela
// chave presa ao cliente (chaveCofreEmail) e põe o texto pelo modelo vigente (textoPeloModelo). O marcador sem valor
// devolve o texto padrão; a recusa da saída (sem servidor, senha fora do cofre, autenticação sem cifra) é um erro com
// a mensagem do domínio, nunca com a senha. A origem (finalidade, modelo, servidor) vai ao registro de envio.
import { chaveCofreEmail, conexaoDaSaida, MENSAGEM_SAIDA, textoPeloModelo } from '@sgh/dominio-acesso';
import type { LerSegredo } from './cofre-leitura.js';
import type { SaidaDoCadastro } from './email-saida-propria.js';
import type { OrigemDoEnvio } from './registro-envio-proprio.js';
import { type ConexaoSmtp, enviarPelaConexao, type MensagemEmail } from './smtp.js';

export interface AmbienteDoEnvio {
  readonly producao: boolean;
  /** O servidor do ambiente (fora de produção, a captura local em loopback); nulo sem ele. */
  readonly local: { readonly host: string; readonly porta: number } | null;
  readonly remetentePadrao: string;
  readonly lerSegredo: LerSegredo | null;
  /** Teste: quem conecta (padrão: o cliente SMTP do worker). */
  readonly conectar?: (c: ConexaoSmtp, m: MensagemEmail) => Promise<void>;
}

export interface SaidaPreparada {
  readonly origem: OrigemDoEnvio;
  /**
   * A mensagem pelo modelo vigente (com os valores dos marcadores) ou, sem modelo, sem valores (null) ou com marcador
   * sem valor, a padrão com o remetente do cadastro.
   */
  montar(padrao: MensagemEmail, valores: Readonly<Record<string, string>> | null): MensagemEmail;
  enviar(m: MensagemEmail): Promise<void>;
}

export async function prepararSaida(
  cadastro: SaidaDoCadastro | null,
  cliente: string,
  amb: AmbienteDoEnvio,
): Promise<SaidaPreparada> {
  const conexao = conexaoDaSaida(cadastro?.servidor ?? null, {
    producao: amb.producao,
    local: amb.local,
    remetentePadrao: amb.remetentePadrao,
  });
  if ('recusa' in conexao) throw new Error(MENSAGEM_SAIDA[conexao.recusa]);
  let senha: string | null = null;
  if (conexao.usuario) {
    const chave = chaveCofreEmail(cliente, conexao.referenciaCofre);
    senha = chave && amb.lerSegredo ? await amb.lerSegredo(chave) : null;
    if (!senha) throw new Error(MENSAGEM_SAIDA['senha-indisponivel']);
  }
  let modeloUsado: number | null = null;
  const conectar = amb.conectar ?? enviarPelaConexao;
  return {
    origem: {
      finalidade: cadastro?.finalidade ?? null,
      get modelo() {
        return modeloUsado;
      },
      servidor: conexao.servidor,
    },
    montar(padrao, valores) {
      const doCadastro: MensagemEmail = {
        ...padrao,
        de: conexao.remetente,
        deNome: conexao.remetenteNome,
        responderPara: conexao.responderPara,
      };
      if (!cadastro?.modelo || !valores) return doCadastro;
      const t = textoPeloModelo(cadastro.modelo, valores);
      if ('faltando' in t) return doCadastro;
      modeloUsado = cadastro.modelo.id;
      return {
        ...padrao,
        de: t.remetente ?? conexao.remetente,
        deNome: t.remetenteNome ?? conexao.remetenteNome,
        responderPara: t.responderPara ?? conexao.responderPara,
        assunto: t.assunto,
        texto: t.texto,
      };
    },
    enviar: (m) =>
      conectar(
        {
          host: conexao.host,
          porta: conexao.porta,
          seguranca: conexao.seguranca,
          usuario: conexao.usuario,
          senha,
          tempoMs: conexao.tempoLimiteSegundos * 1000,
        },
        m,
      ),
  };
}
