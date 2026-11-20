// Retorno do laboratório de apoio (M34; ficha, regra 13 e seção 5; cap-12 §12.2, Laboratório de apoio): o resultado
// entra ESTRUTURADO pelo de-para do estabelecimento (o mesmo cadastro que a interface em uso lê), aparece na fila de
// conferência e só é gravado no exame depois que o responsável técnico habilitado aprova — pelo executor do M04, com a
// receita `sadt.registrarResultado` (cenário origem-apoio: o responsável como emissor). O que não casa com o de-para
// segura a aprovação (nada é gravado no escuro). Recusar exige o motivo. Uma interface por estabelecimento de cada
// vez: a troca do legado para o conector é liberação da Fase 4 (a chave `integracao.apoio`), reversível.
import {
  EVENTOS_AUDITAVEIS,
  esquemaConferirRetorno,
  PERMISSOES_M34_CODIGOS as P,
  type RetornoApoioLido,
} from '@sgh/contratos';
import { casarResultado, lerResultadoApoio, podeAprovar } from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import {
  contextoOperacao,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
} from '../../cadastro/comum.js';
import type { ConfiguracaoM34 } from '../../relatorio/public-api.js';
import type { ArmazemConteudo } from '../infra/armazem-conteudo.js';
import type { PortaIntegracao } from '../porta.js';

const sujeito = (s: SessaoCadastro) => ({
  rede: s.rede,
  hospital: s.hospital,
  login: s.login,
  setor: s.req.sgh?.sessao.unidadeAtiva ?? null,
});

export class ServicoRetornoApoio {
  constructor(
    private readonly porta: PortaIntegracao,
    private readonly armazem: ArmazemConteudo,
    private readonly config: ConfiguracaoM34,
    private readonly trilha: RegistradorTrilha,
  ) {}

  /** Um retorno: o conteúdo lido do armazém, o exame do pedido e o casamento pelo de-para. */
  private async montar(s: SessaoCadastro, id: string): Promise<RetornoApoioLido | null> {
    const r = await this.porta.recebida(s.porta, id);
    if (!r || !r.tipo.startsWith('ORU') || !r.chaveS3) return null;
    const conteudo = await this.armazem.ler(s.rede, r.chaveS3);
    if (conteudo === null) return null;
    const lido = lerResultadoApoio(conteudo);
    const exame = lido.pedido ? await this.porta.exameDoRetorno(s.porta, lido.pedido) : null;
    const interfaces = await this.porta.interfacesApoio(s.porta);
    const dePara = interfaces[0]
      ? await this.porta.deParaExame(s.porta, interfaces[0].codigo, lido.exameLaboratorio)
      : { exame: null, elementos: [] };
    const casado = casarResultado(
      lido.valores,
      dePara.elementos.map((d) => ({ codigoLaboratorio: d.codigoLaboratorio, nome: d.nome })),
      exame?.elementos ?? [],
    );
    return {
      recebida: r.id,
      protocolo: lido.protocolo,
      exame: exame?.id ?? lido.pedido ?? 0,
      exameNome: exame?.exameNome ?? null,
      paciente: { id: exame?.paciente ?? null, nome: null },
      elementos: casado.elementos,
      observacao: lido.observacoes.join(' ').slice(0, 300) || null,
      // O exame do laboratório sem de-para no estabelecimento segura tudo (nem o exame de um elemento casa direto).
      semDePara: [
        ...(dePara.exame === null ? [lido.exameLaboratorio || 'exame sem código'] : casado.semDePara),
        ...(exame ? [] : ['exame do pedido não encontrado']),
      ],
      situacao: r.situacao,
      recebidoEm: r.recebidoEm.toISOString().slice(0, 19),
    };
  }

  async fila(s: SessaoCadastro): Promise<RetornoApoioLido[]> {
    const l = await this.porta.recebidas(s.porta, { situacao: 'conferir', limite: 100 });
    const r: RetornoApoioLido[] = [];
    for (const x of l) {
      const m = await this.montar(s, x.id).catch(() => null);
      if (m) r.push(m);
    }
    return r;
  }

  async conferir(
    s: SessaoCadastro,
    id: string,
    corpo: unknown,
  ): Promise<{ situacao: string; exame: number }> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Retorno não encontrado');
    const c = esquemaConferirRetorno.safeParse(corpo);
    if (!c.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Conferência inválida',
        c.error.issues.map((i) => i.message).join(' '),
        {
          campos: c.error.issues.map((i) => String(i.path[0] ?? '')),
        },
      );
    await this.config.exigir(sujeito(s), 'integracao.apoio');
    const m = await this.montar(s, id);
    if (!m || m.situacao !== 'conferir')
      throw new ErroProblema('nao-encontrado', 404, 'Retorno não está na fila de conferência');
    const trilhaDe = (op: string) =>
      linhaTrilha(s, EVENTOS_AUDITAVEIS.integracaoRetornoConferido.codigo, 'integracao.apoio', op, {
        tabela: 'SGH_INTG_RECEBIDA',
        id,
        paciente: m.paciente.id,
        chave: m.protocolo.slice(0, 40),
      });
    if (c.data.decisao === 'recusar') {
      await this.porta.gravarSgh(s.porta, trilhaDe('recusar'), (g) =>
        g.concluirRecebida(id, {
          situacao: 'recusada',
          detalhe: c.data.motivo,
          tabelaObjeto: 'SILANEXA',
          idObjeto: String(m.exame),
          usuario: s.login,
        }),
      );
      return { situacao: 'recusada', exame: m.exame };
    }
    // O responsável técnico habilitado: a permissão (com conselho) e um vínculo ativo da sessão.
    const vinculo = (await this.porta.vinculos(s.porta, s.login)).find((v) => v.ativo && v.conselho > 0);
    const ok = podeAprovar({
      elementos: m.elementos.length,
      semDePara: m.semDePara.length,
      habilitado: s.pode(P.apoioConferir) && vinculo !== undefined,
    });
    if (!ok.pode)
      throw new ErroProblema('operacao-bloqueada', 409, 'Não é possível aprovar', ok.motivo ?? '', {
        codigo: 'retorno-nao-aprovavel',
      });
    const lido = await this.porta.exameLido(s.porta, m.exame);
    if (!lido) throw new ErroProblema('nao-encontrado', 404, 'Exame do pedido não encontrado');
    const r = await this.porta
      .executar(
        s.porta,
        'sadt.registrarResultado',
        {
          exame: lido,
          elementos: m.elementos.map((e) => ({
            elemento: e.elemento,
            numerico: e.numerico,
            alfa: e.alfa,
            absoluta: null,
          })),
          observacoes: [`Laboratório de apoio, protocolo ${m.protocolo.slice(0, 60)}.`],
          variaveis: [],
          emissor: vinculo!.vinculo,
        },
        contextoOperacao(s, 'integracao.retornoApoio'),
      )
      .catch((e: unknown) => {
        throw e instanceof ErroOperacao ? problemaDoCadastro(e) : e;
      });
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento: 'sadt.resultado.registrado',
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: 'integracao',
        correlacao: id,
        recurso: 'sadt.resultado',
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(m.exame),
      });
    await this.porta.gravarSgh(s.porta, trilhaDe('aprovar'), (g) =>
      g.concluirRecebida(id, {
        situacao: 'processada',
        detalhe: `${m.elementos.length} elemento(s) gravado(s)`,
        tabelaObjeto: 'SILANEXA',
        idObjeto: String(r.resultado['exame'] ?? m.exame),
        usuario: s.login,
      }),
    );
    return { situacao: 'processada', exame: m.exame };
  }
}
