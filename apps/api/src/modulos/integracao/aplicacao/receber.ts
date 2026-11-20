// Entrada idempotente das integrações novas (M34; ficha, regra 8; cap-12 §12.3, Entrada e Idempotência): o parceiro
// entra com a credencial do cliente de integração (o segredo conferido pelo resumo, em tempo constante; o escopo do
// tipo de mensagem), a mensagem é identificada pela CHAVE DO PARCEIRO (MSH-10 no HL7, o ID do recurso no FHIR, a
// Idempotency-Key nas demais) e a repetida devolve a primeira resposta, sem gravar de novo. O conteúdo vai ao S3
// (nunca ao banco nem ao log): no banco, só os metadados e o resumo SHA-256. O resultado do laboratório de apoio entra
// "a conferir" pelo responsável técnico (regra 13): nada é gravado no exame antes da conferência.
import { EVENTOS_AUDITAVEIS, esquemaMensagemParceiroRecebida, type RespostaRecebida } from '@sgh/contratos';
import { lerMensagem, lerResultadoApoio } from '@sgh/dominio-integracao';
import { ErroProblema } from '../../../problema.filter.js';
import { type ArmazemConteudo, chaveDoConteudo, resumoSha256 } from '../infra/armazem-conteudo.js';
import type { ContextoIntegracao, PortaIntegracao } from '../porta.js';
import { lerAutorizacaoBasica, segredoConfere } from './credencial.js';

/** O escopo que cada tipo de mensagem exige do cliente. */
export function escopoDoTipo(tipo: string): string {
  if (tipo.startsWith('ORU')) return 'resultado.enviar';
  if (tipo.startsWith('ORM') || tipo.startsWith('OML')) return 'pedido.receber';
  if (tipo === 'Patient' || tipo === 'Bundle') return 'paciente.identificar';
  return 'resultado.enviar';
}

/** A chave do parceiro: MSH-10 no HL7, o ID do recurso no FHIR, senão a Idempotency-Key do pedido. */
export function chaveDoParceiro(tipo: string, conteudo: string, idempotencia: string | null): string {
  const t = conteudo.trimStart();
  if (t.startsWith('MSH|')) {
    const m = lerMensagem(t);
    if (!m.controle) throw new ErroProblema('entrada-invalida', 400, 'Mensagem sem o MSH-10');
    return m.controle.slice(0, 120);
  }
  if (t.startsWith('{')) {
    let id: unknown;
    try {
      id = (JSON.parse(t) as Record<string, unknown>)['id'];
    } catch {
      throw new ErroProblema('entrada-invalida', 400, 'Recurso FHIR ilegível');
    }
    if (typeof id === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(id)) return `${tipo}/${id}`;
  }
  if (idempotencia && /^[A-Za-z0-9._:-]{8,120}$/.test(idempotencia)) return idempotencia;
  throw new ErroProblema(
    'entrada-invalida',
    400,
    'Mensagem sem identificador',
    'Envie a Idempotency-Key do pedido (a mensagem não traz o identificador do parceiro).',
  );
}

export interface PedidoEntrada {
  readonly hospital: string;
  readonly rede: string;
  readonly autorizacao: unknown;
  readonly idempotencia: string | null;
  readonly corpo: unknown;
  readonly estacao: string;
}

export class ServicoEntrada {
  constructor(
    private readonly porta: PortaIntegracao,
    private readonly armazem: ArmazemConteudo,
  ) {}

  async receber(p: PedidoEntrada): Promise<RespostaRecebida> {
    const c: ContextoIntegracao = { rede: p.rede, hospital: p.hospital };
    const cred = lerAutorizacaoBasica(p.autorizacao);
    const negar = () =>
      new ErroProblema(
        'nao-autenticado',
        401,
        'Credencial do parceiro inválida',
        'Confira o cliente e o segredo.',
      );
    if (!cred) throw negar();
    const registro = await this.porta.credencial(c, cred.clienteId);
    if (!registro || !segredoConfere(cred.segredo, registro.resumo)) throw negar();
    if (!registro.ativo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Parceiro desativado',
        'O parceiro não está ativo neste estabelecimento.',
      );
    const m = esquemaMensagemParceiroRecebida.safeParse(p.corpo);
    if (!m.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Mensagem inválida',
        m.error.issues.map((i) => i.message).join(' '),
      );
    if (m.data.parceiro !== registro.codigo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Mensagem de outro parceiro',
        'O parceiro da mensagem não é o da credencial.',
      );
    const escopo = escopoDoTipo(m.data.tipo);
    if (!registro.escopos.includes(escopo))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo do parceiro',
        `A credencial não tem o escopo ${escopo}.`,
      );
    const chave = chaveDoParceiro(m.data.tipo, m.data.conteudo, p.idempotencia);
    const resumo = resumoSha256(m.data.conteudo);
    // O resultado do laboratório de apoio: lido agora (o formato), conferido depois pelo responsável técnico.
    let situacao: 'recebida' | 'conferir' | 'recusada' = 'recebida';
    let detalhe: string | null = null;
    let pedido: number | null = null;
    if (m.data.tipo.startsWith('ORU')) {
      try {
        const r = lerResultadoApoio(m.data.conteudo);
        pedido = r.pedido;
        situacao = pedido ? 'conferir' : 'recusada';
        detalhe = pedido
          ? `${r.valores.length} valor(es); protocolo ${r.protocolo.slice(0, 40)}`
          : 'Resultado sem o pedido (OBR-2).';
      } catch (e) {
        situacao = 'recusada';
        detalhe = e instanceof Error ? e.message.slice(0, 200) : 'Mensagem ilegível.';
      }
    }
    const chaveS3 = await this.armazem
      .gravar(p.rede, chaveDoConteudo(p.hospital, registro.codigo, 'entrada', resumo), m.data.conteudo)
      .catch(() => {
        throw new ErroProblema(
          'indisponivel',
          503,
          'Armazenamento indisponível',
          'A mensagem não foi aceita: tente de novo (a mesma chave não entra duas vezes).',
        );
      });
    const r = await this.porta.gravarSgh(
      c,
      (x: { recebida: { id: string }; repetida: boolean }) => ({
        rede: p.rede,
        hospital: p.hospital,
        usuario: `INTG.${registro.codigo}`.slice(0, 31),
        evento: EVENTOS_AUDITAVEIS.integracaoMensagemRecebida.codigo,
        recurso: 'integracao.entrada',
        operacao: x.repetida ? 'repetida' : situacao,
        tabelaAlvo: 'SGH_INTG_RECEBIDA',
        idAlvo: x.recebida.id,
        chaveNaturalAlvo: chave.slice(0, 60),
        resultado: 'sucesso',
        estacao: p.estacao.slice(0, 80),
        correlacao: resumo.slice(0, 64),
      }),
      (g) =>
        g.registrarRecebida({
          parceiro: registro.codigo,
          tipo: m.data.tipo,
          chaveParceiro: chave,
          hash: resumo,
          chaveS3,
          tamanho: Buffer.byteLength(m.data.conteudo, 'utf8'),
          situacao,
          detalhe,
          tabelaObjeto: pedido ? 'SILANEXA' : null,
          idObjeto: pedido ? String(pedido) : null,
        }),
    );
    return {
      id: r.recebida.id,
      situacao: r.recebida.situacao,
      repetida: r.repetida,
      chaveParceiro: r.recebida.chaveParceiro,
      resumo: r.recebida.hash,
    };
  }
}
