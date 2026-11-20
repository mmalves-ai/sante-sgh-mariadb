// Porta das contas médicas sobre o núcleo do legado (M56, etapa 6, F5): cada leitura numa transação curta READ ONLY no
// banco do estabelecimento; as gravações só do novo (SGH_OPE_CONTA, _GUIA, _ITEM e _EVT) numa transação SGH_ com a
// SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia compartilhada, as gravações
// são recusadas (`sghSoLeitura`).
import {
  autorizacoesPorSenha,
  concluirAnaliseSgh,
  contaSgh,
  contasSgh,
  decidirRecursoContaSgh,
  decidirRecursoItensSgh,
  designacoesDoUsuario,
  devolverContaSgh,
  elegibilidadeSgh,
  eventosContaSgh,
  glosarContaSgh,
  gravarTrilha,
  guiasContaSgh,
  guiasJaApresentadasSgh,
  itensContaSgh,
  type Leitor,
  loteJaRecebidoSgh,
  motivosGlosa,
  type NucleoLegado,
  operadorasSgh,
  pagamentosSgh,
  prestadoresParaAutorizacao,
  prestadorPorDocumento,
  proximaSequenciaProtocoloConta,
  receberContaSgh,
  recursosItensDaContaSgh,
  registrarPagamentoContaSgh,
  registrarRecursoContaSgh,
  registrarRecursoItensSgh,
  relogioRecepcao,
  somenteSgh,
  totaisContasSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoContas, METODOS_PORTA_CONTAS, type PortaContasOperadora } from './contas-porta.js';

export function portaContasOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaContasOperadora {
  const ctx = (c: ContextoContas) => ({ rede: c.rede, hospital: c.hospital, traceId: 'operadora-contas' });
  const ler = <T>(c: ContextoContas, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 19).replace(' ', 'T') };
      }),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    prestadores: (c) =>
      ler(c, async (l) =>
        (await prestadoresParaAutorizacao(l, c.hospital)).map((p) => ({ id: p.id, nome: p.nome })),
      ),
    prestadorPorDocumento: (c, documento) => ler(c, (l) => prestadorPorDocumento(l, c.hospital, documento)),
    elegibilidade: (c, carteirinha) => ler(c, (l) => elegibilidadeSgh(l, c.hospital, carteirinha)),
    autorizacoesPorSenha: (c, senhas) => ler(c, (l) => autorizacoesPorSenha(l, c.hospital, senhas)),
    guiasJaApresentadas: (c, prestador, numeros) =>
      ler(c, (l) => guiasJaApresentadasSgh(l, c.hospital, prestador, numeros)),
    loteJaRecebido: (c, x) => ler(c, (l) => loteJaRecebidoSgh(l, { hospital: c.hospital, ...x })),
    motivos: (c) => ler(c, (l) => motivosGlosa(l)),
    designacoes: (c, login) => ler(c, (l) => designacoesDoUsuario(l, c.hospital, login)),
    contas: (c, f) => ler(c, (l) => contasSgh(l, c.hospital, f)),
    totais: (c) => ler(c, (l) => totaisContasSgh(l, c.hospital)),
    conta: (c, id) => ler(c, (l) => contaSgh(l, c.hospital, id)),
    guias: (c, id) => ler(c, (l) => guiasContaSgh(l, c.hospital, id)),
    itens: (c, id) => ler(c, (l) => itensContaSgh(l, c.hospital, id)),
    eventos: (c, id) => ler(c, (l) => eventosContaSgh(l, c.hospital, id)),
    recursosItens: (c, id) => ler(c, (l) => recursosItensDaContaSgh(l, c.hospital, id)),
    pagamentos: (c, f) => ler(c, (l) => pagamentosSgh(l, c.hospital, f)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: as contas médicas não são gravadas.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          proximoProtocolo: () => proximaSequenciaProtocoloConta(e),
          receber: (x) => receberContaSgh(e, { hospital: h, ...x }),
          glosar: (x) => glosarContaSgh(e, { hospital: h, ...x }),
          concluir: (x) => concluirAnaliseSgh(e, { hospital: h, ...x }),
          devolver: (x) => devolverContaSgh(e, { hospital: h, ...x }),
          registrarRecurso: (x) => registrarRecursoContaSgh(e, { hospital: h, ...x }),
          decidirRecurso: (x) => decidirRecursoContaSgh(e, { hospital: h, ...x }),
          pagar: (x) => registrarPagamentoContaSgh(e, { hospital: h, ...x }),
          registrarRecursoItens: (x) => registrarRecursoItensSgh(e, { hospital: h, ...x }),
          decidirRecursoItens: (x) => decidirRecursoItensSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaContasOperadoraIndisponivel(): PortaContasOperadora {
  return portaIndisponivel<PortaContasOperadora>(METODOS_PORTA_CONTAS);
}
