// Envio pelo cadastro do cliente (01-ADM L77, C1-063), para as saídas fora da fila de alertas (relatório agendado,
// aviso do sistema): com a saída lida (email-saida-propria.ts), monta a conexão pela regra do domínio (conexaoDaSaida:
// fora de produção sempre a captura local, sem senha; em produção o servidor cadastrado), lê a senha no cofre pela
// chave presa ao cliente (chaveCofreEmail) e põe o texto pelo modelo vigente (textoPeloModelo). O marcador sem valor
// devolve o texto padrão; a recusa da saída (sem servidor, senha fora do cofre, autenticação sem cifra) não é lançada na
// preparação: o enviar da saída preparada é que a lança (erroDaRecusa: mensagem do domínio, motivo no nome, nunca a
// senha), para que a tentativa recusada passe pelo entregarComRegistro e fique no envio_email como falha, com a
// finalidade e o servidor do cadastro. A origem (finalidade, modelo, servidor) vai ao registro de envio.
// A saída do ambiente (prepararSaida sem cadastro) é o caminho que não depende do cadastro: o alerta ao dono da falha.
import {
  chaveCofreEmail,
  conexaoDaSaida,
  erroDaRecusa,
  type RecusaSaida,
  textoPeloModelo,
} from '@sgh/dominio-acesso';
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
  /** A recusa da saída (nula: pronta); com ela, o enviar lança o erro da recusa sem conectar. */
  readonly recusa: RecusaSaida | null;
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
  if ('recusa' in conexao) return saidaRecusada(cadastro, amb, conexao.recusa);
  let senha: string | null = null;
  if (conexao.usuario) {
    const chave = chaveCofreEmail(cliente, conexao.referenciaCofre);
    senha = chave && amb.lerSegredo ? await amb.lerSegredo(chave) : null;
    if (!senha) return saidaRecusada(cadastro, amb, 'senha-indisponivel');
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
    recusa: null,
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

/**
 * A saída recusada: nada é conectado; a mensagem leva o texto padrão com o remetente do cadastro, a origem leva a
 * finalidade e o servidor do cadastro (o que falhou), e o enviar lança o erro da recusa, que o registro guarda.
 */
function saidaRecusada(
  cadastro: SaidaDoCadastro | null,
  amb: AmbienteDoEnvio,
  recusa: RecusaSaida,
): SaidaPreparada {
  const servidor = cadastro?.servidor ?? null;
  return {
    origem: { finalidade: cadastro?.finalidade ?? null, modelo: null, servidor: servidor?.id ?? null },
    recusa,
    montar: (padrao) => ({
      ...padrao,
      de: servidor?.remetenteEmail ?? amb.remetentePadrao,
      deNome: servidor?.remetenteNome ?? null,
      responderPara: servidor?.responderPara ?? null,
    }),
    enviar: () => Promise.reject(erroDaRecusa(recusa)),
  };
}
