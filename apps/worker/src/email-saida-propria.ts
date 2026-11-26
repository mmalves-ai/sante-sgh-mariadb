// Saída do e-mail do sistema pelo cadastro do cliente (01-ADM L77): para cada alerta da fila `email-<cliente>`, lê no
// banco do cliente a finalidade do alerta, ou a da saída pelo código (relatório agendado, aviso do sistema) (finalidade_email, carga inicial da migração 02_ADM/99), os servidores de
// saída ativos (servidor_email) e o modelo vigente da finalidade (modelo_email); a escolha é a regra do domínio
// (servidorDaSaida, modeloVigente). Só leitura: nada é gravado aqui (o registro de envio fica com
// registro-envio-proprio.ts).
import {
  codigoDaFinalidade,
  type ModeloDeSaida,
  type ModeloEmailVigente,
  modeloVigente,
  servidorDaSaida,
  type ServidorDeSaida,
} from '@sgh/dominio-acesso';
import type { Leitor } from '@sgh/nucleo';
import type { NucleoWorker } from './servico-worker.js';

export interface SaidaDoCadastro {
  readonly estabelecimento: number | null;
  readonly finalidade: number | null;
  readonly servidor: ServidorDeSaida | null;
  readonly modelo: ModeloDeSaida | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** DATE do banco como AAAA-MM-DD (o driver pode devolver Date ou texto). */
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);

export async function lerSaidaDoCadastro(
  l: Leitor,
  tipoAlerta: string,
  codigoEstabelecimento: string | null,
  agora: Date,
): Promise<SaidaDoCadastro> {
  const codigoFinalidade = codigoDaFinalidade(tipoAlerta);
  const f = codigoFinalidade
    ? await l.uma('SELECT id FROM finalidade_email WHERE codigo = ? AND ativo = TRUE', [codigoFinalidade])
    : null;
  const finalidade = f ? Number(f['id']) : null;
  const e = codigoEstabelecimento
    ? await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        codigoEstabelecimento,
      ])
    : null;
  const estabelecimento = e ? Number(e['id']) : null;
  const linhasServidor = await l.consultar(
    `SELECT id, estabelecimento_id, finalidade_email_id, host, porta, seguranca, exige_autenticacao,
            usuario_autenticacao, referencia_cofre, remetente_email, remetente_nome, responder_para,
            tempo_limite_segundos, padrao, ativo
       FROM servidor_email WHERE ativo = TRUE AND protocolo = 'smtp'`,
    [],
    { teto: 200 },
  );
  const servidores: ServidorDeSaida[] = linhasServidor.map((x) => ({
    id: Number(x['id']),
    estabelecimento: num(x['estabelecimento_id']),
    finalidade: num(x['finalidade_email_id']),
    host: String(x['host']),
    porta: Number(x['porta']),
    seguranca: String(x['seguranca']),
    exigeAutenticacao: bool(x['exige_autenticacao']),
    usuarioAutenticacao: texto(x['usuario_autenticacao']),
    referenciaCofre: texto(x['referencia_cofre']),
    remetenteEmail: String(x['remetente_email']),
    remetenteNome: texto(x['remetente_nome']),
    responderPara: texto(x['responder_para']),
    tempoLimiteSegundos: Number(x['tempo_limite_segundos']),
    padrao: bool(x['padrao']),
    ativo: bool(x['ativo']),
  }));
  let modelo: ModeloDeSaida | null = null;
  if (finalidade !== null) {
    const linhasModelo = await l.consultar(
      `SELECT id, estabelecimento_id, finalidade_email_id, ativo, vigencia_inicio, vigencia_fim, assunto, corpo_html,
              corpo_texto, remetente_email, remetente_nome, responder_para
         FROM modelo_email WHERE finalidade_email_id = ? AND ativo = TRUE`,
      [finalidade],
      { teto: 200 },
    );
    const modelos: (ModeloEmailVigente & ModeloDeSaida)[] = linhasModelo.map((x) => ({
      id: Number(x['id']),
      estabelecimento: num(x['estabelecimento_id']),
      finalidade: Number(x['finalidade_email_id']),
      ativo: bool(x['ativo']),
      vigenciaInicio: dia(x['vigencia_inicio']),
      vigenciaFim: dia(x['vigencia_fim']),
      assunto: String(x['assunto']),
      corpoHtml: String(x['corpo_html']),
      corpoTexto: texto(x['corpo_texto']),
      remetenteEmail: texto(x['remetente_email']),
      remetenteNome: texto(x['remetente_nome']),
      responderPara: texto(x['responder_para']),
    }));
    modelo = modeloVigente(modelos, finalidade, estabelecimento, dia(agora) ?? '') ?? null;
  }
  return {
    estabelecimento,
    finalidade,
    servidor: servidorDaSaida(servidores, finalidade, estabelecimento),
    modelo,
  };
}

/** A leitura pelo núcleo do worker, no banco do cliente. */
export function saidaDoCliente(
  nucleo: NucleoWorker,
  cliente: string,
  tipoAlerta: string,
  codigoEstabelecimento: string | null,
  agora = new Date(),
): Promise<SaidaDoCadastro> {
  return nucleo.lerSomente({ cliente, estabelecimento: null, correlacao: 'email-saida' }, (l) =>
    lerSaidaDoCadastro(l, tipoAlerta, codigoEstabelecimento, agora),
  );
}
