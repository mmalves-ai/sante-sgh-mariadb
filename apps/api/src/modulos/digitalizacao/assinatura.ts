// Assinatura ICP-Brasil dos documentos digitalizados por quem conferiu a fidelidade (M50, etapa 6; ficha, regra 12;
// Lei 13.787/2018, art. 3; CFM1821-02), sobre o serviço do M49 (o hash, nunca o documento; a validação no servidor; o
// carimbo do tempo da ACT, política AD-RT; formato CAdES destacado do PDF guardado):
//   - o PEDIDO (`iniciar`): os documentos conferidos pela própria pessoa, o resumo de cada arquivo relido no
//     armazenamento (o arquivo que mudou não é assinado) e o pedido do M49 com a finalidade `digitalizacao`;
//   - a CONCLUSÃO (volta do provedor ou resposta do agente local, chamada pelo M49): cada assinatura validada no
//     servidor; válida → o documento "assinado" com a assinatura e a validação na mesma transação e a trilha; inválida ou
//     com a fonte fora do ar → a evidência (a assinatura em "falha" e a validação) e o documento continua conferido,
//     para assinar de novo (D-PENDENTE-506).
import { createHash } from 'node:crypto';
import {
  type AutorizacaoPsc,
  type DesafioAgenteLocal,
  EVENTOS_AUDITAVEIS as E,
  PERMISSOES_DIGITALIZACAO as P,
  type ResultadoFluxoAssinatura,
} from '@sgh/contratos';
import { conferirAssinaturas, type ConfiguracaoPsc } from '@sgh/dominio-documento';
import type {
  CertificadoGravado,
  DigitalizacaoSghLida,
  PedidoAssinaturaGravado,
  ProvedorGravado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../cadastro/comum.js';
import { cpfCruzadoDiverge, type ServicoAssinaturaIcp } from '../assinatura/aplicacao/servico.js';
import { ErroIndisponivel } from '../assinatura/infra/clientes.js';
import type { PortaAssinaturaIcp } from '../assinatura/porta.js';
import type { ArmazemDigitalizacao } from './armazem.js';
import type { PortaDigitalizacao } from './porta.js';

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const mesma = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();

interface ItemConcluido {
  readonly id: number;
  readonly assinado: boolean;
  readonly motivo: string | null;
}

export class ServicoAssinaturaDigitalizacao {
  constructor(
    private readonly icp: ServicoAssinaturaIcp,
    private readonly portaIcp: PortaAssinaturaIcp,
    private readonly porta: PortaDigitalizacao,
    private readonly armazem: ArmazemDigitalizacao,
  ) {
    icp.digitalizacao = {
      concluirNuvem: (s, p, c, t, pr) => this.concluirNuvem(s, p, c, t, pr),
      concluirAgente: (s, p, h, c) => this.concluirAgente(s, p, h, c),
    };
  }

  /** O documento pode ir ao pedido? Conferido pela própria pessoa e o arquivo guardado com o mesmo resumo. */
  private async apto(s: SessaoCadastro, d: DigitalizacaoSghLida): Promise<string | null> {
    if (d.situacao !== 'conferido') return d.situacao === 'assinado' ? 'ja-assinado' : 'nao-conferido';
    if (!mesma(d.conferidoPor, s.login)) return 'assinante-nao-conferiu';
    const bytes = await this.armazem.ler(s.hospital, d.arquivoChave);
    if (!bytes || sha256Hex(bytes) !== d.hash) return 'arquivo-divergente';
    return null;
  }

  async iniciar(
    s: SessaoCadastro,
    ids: readonly number[],
    certificado: number,
  ): Promise<AutorizacaoPsc | DesafioAgenteLocal> {
    const docs = await this.porta.porIds(s.porta, ids);
    if (docs.length !== ids.length)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Documento não encontrado',
        'Algum documento não existe.',
      );
    for (const d of docs) {
      const motivo = await this.apto(s, d);
      if (motivo)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Assinatura recusada',
          motivo === 'assinante-nao-conferiu'
            ? `O documento ${d.lote}/${d.ordem} foi conferido por outra pessoa: quem assina é quem conferiu.`
            : motivo === 'arquivo-divergente'
              ? `O arquivo do documento ${d.lote}/${d.ordem} não confere com o resumo guardado: capture de novo.`
              : `O documento ${d.lote}/${d.ordem} não está conferido como fiel (ou já foi assinado).`,
          { codigo: motivo },
        );
    }
    const ordem = ids.map((id) => docs.find((d) => d.id === id)!);
    return this.icp.iniciarAssinaturaDigitalizacao(
      s,
      certificado,
      ordem.map((d) => d.hash),
      ordem.map((d) => d.id),
    );
  }

  private resultado(itens: readonly ItemConcluido[], certificado: number | null): ResultadoFluxoAssinatura {
    const assinados = itens.filter((x) => x.assinado).length;
    const recusados = itens.length - assinados;
    return {
      finalidade: 'digitalizacao',
      ok: assinados > 0 && recusados === 0,
      certificado,
      assinatura: null,
      motivo: itens.find((x) => !x.assinado)?.motivo ?? null,
      lote: { assinados, pendentes: 0, recusados },
    };
  }

  /** Os itens do pedido: o documento de cada ID com o mesmo resumo do pedido, ainda apto. */
  private async itensDoPedido(s: SessaoCadastro, pedido: PedidoAssinaturaGravado) {
    const docs = await this.porta.porIds(s.porta, pedido.documentos);
    const ok: { d: DigitalizacaoSghLida; hash: string }[] = [];
    const recusados: ItemConcluido[] = [];
    for (const [k, id] of pedido.documentos.entries()) {
      const d = docs.find((x) => x.id === id);
      const hash = pedido.hashes[k] ?? '';
      const motivo = !d ? 'nao-encontrado' : d.hash !== hash ? 'arquivo-divergente' : await this.apto(s, d);
      if (d && !motivo) ok.push({ d, hash });
      else recusados.push({ id, assinado: false, motivo });
    }
    return { ok, recusados };
  }

  private async certificadoDoPedido(s: SessaoCadastro, pedido: PedidoAssinaturaGravado) {
    const c = pedido.certificado ? await this.portaIcp.certificado(s.porta, pedido.certificado) : null;
    return c?.certificadoDer && c.usuario === s.login ? c : null;
  }

  async concluirNuvem(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaGravado,
    cfg: ConfiguracaoPsc,
    token: string,
    provedor: ProvedorGravado,
  ): Promise<ResultadoFluxoAssinatura> {
    const cert = await this.certificadoDoPedido(s, pedido);
    if (!cert)
      return this.resultado(
        pedido.documentos.map((id) => ({ id, assinado: false, motivo: 'certificado-divergente' })),
        null,
      );
    const { ok, recusados } = await this.itensDoPedido(s, pedido);
    const itens: ItemConcluido[] = [...recusados];
    if (ok.length) {
      let r: ReturnType<typeof conferirAssinaturas>;
      try {
        r = conferirAssinaturas(
          await this.icp.cfg.psc.assinar(
            cfg,
            token,
            ok.map((x, k) => ({ id: String(k + 1), alias: `digitalizacao-${x.d.id}`, hashHex: x.hash })),
            'principal',
          ),
          ok.map((_, k) => String(k + 1)),
        );
      } catch (e) {
        if (!(e instanceof ErroIndisponivel)) throw e;
        await this.icp.falhaNaTrilha(
          s,
          E.assinaturaFalhou.codigo,
          'hotelaria.digitalizacao',
          'psc-indisponivel',
        );
        return this.resultado(
          [...itens, ...ok.map((x) => ({ id: x.d.id, assinado: false, motivo: 'psc-indisponivel' }))],
          cert.id,
        );
      }
      if (!r.ok) {
        await this.icp.falhaNaTrilha(
          s,
          E.assinaturaFalhou.codigo,
          'hotelaria.digitalizacao',
          'resposta-invalida',
        );
        itens.push(...ok.map((x) => ({ id: x.d.id, assinado: false, motivo: 'resposta-invalida' })));
      } else
        for (const [k, x] of ok.entries())
          itens.push(
            await this.concluirItem(s, x.d, x.hash, cert, r.assinaturas.get(String(k + 1))!, provedor.codigo),
          );
    }
    return this.resultado(itens, cert.id);
  }

  async concluirAgente(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaGravado,
    porHash: ReadonlyMap<string, string>,
    certificadoB64: string,
  ): Promise<ResultadoFluxoAssinatura> {
    const cert = await this.certificadoDoPedido(s, pedido);
    if (!cert || cert.certificadoDer !== certificadoB64)
      return this.resultado(
        pedido.documentos.map((id) => ({ id, assinado: false, motivo: 'certificado-divergente' })),
        null,
      );
    const { ok, recusados } = await this.itensDoPedido(s, pedido);
    const itens: ItemConcluido[] = [...recusados];
    for (const x of ok) {
      const a = porHash.get(x.hash);
      itens.push(
        a
          ? await this.concluirItem(s, x.d, x.hash, cert, b64(a), null)
          : { id: x.d.id, assinado: false, motivo: 'resposta-invalida' },
      );
    }
    return this.resultado(itens, cert.id);
  }

  /** Valida no servidor e grava (válida: o documento assinado; senão, só a evidência), com a trilha. */
  private async concluirItem(
    s: SessaoCadastro,
    d: DigitalizacaoSghLida,
    hash: string,
    cert: CertificadoGravado,
    assinatura: Uint8Array,
    provedor: string | null,
  ): Promise<ItemConcluido> {
    const ident = await this.portaIcp.identidade(s.porta, s.login);
    if (cpfCruzadoDiverge(ident)) {
      await this.icp.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'hotelaria.digitalizacao', 'cpf-divergente');
      return { id: d.id, assinado: false, motivo: 'cpf-divergente' };
    }
    const v = await this.icp.validar({
      certificadoDer: b64(cert.certificadoDer!),
      hash,
      assinatura,
      politica: 'AD-RT',
      cpfDoUsuario: ident?.cpf ?? null,
    });
    const valida = v.resultado === 'valida';
    const assinaturaGravada = {
      origem: 'digitalizacao' as const,
      documento: null,
      hash,
      formato: 'cades' as const,
      politicaIcp: 'AD-RT' as const,
      midia: cert.midia,
      provedor,
      certificado: cert.id,
      usuario: s.login,
      estado: valida ? ('assinada' as const) : ('falha' as const),
      tentativas: 0,
      falha: valida ? null : (v.falha ?? null),
      proximaEm: null,
      assinatura: Buffer.from(assinatura).toString('base64'),
      carimboToken: v.carimboToken,
      carimboEm: v.carimboEm,
      carimboSerie: v.carimboSerie,
    };
    const validacao = {
      momento: 'assinar' as const,
      resultado: v.resultado,
      cadeia: v.cadeia,
      vigencia: v.vigencia,
      revogacao: v.revogacao,
      cpf: v.cpf,
      assinaturaConfere: v.assinaturaConfere,
      carimbo: v.carimbo,
      motivos: v.motivos,
      usuario: s.login,
      em: new Date(),
    };
    const evento = valida ? E.digitalizacaoAssinada.codigo : E.assinaturaFalhou.codigo;
    await this.porta.gravarSgh(
      s.porta,
      (id: number) => ({
        ...linhaTrilha(s, evento, P.conferir, 'internacao.conferirDigitalizacao', {
          tabela: 'SGH_HOT_DIGITALIZACAO',
          id: String(d.id),
          paciente: d.paciente,
          chave: `lote=${d.lote}:assinatura=${id}:${v.resultado}`,
        }),
        resultado: valida ? 'sucesso' : 'falha',
      }),
      (g) =>
        valida
          ? g.assinar({ id: d.id, assinatura: assinaturaGravada, validacao, usuario: s.login })
          : g.registrarFalha({ assinatura: assinaturaGravada, validacao }),
    );
    return { id: d.id, assinado: valida, motivo: valida ? null : (v.motivos[0] ?? v.resultado) };
  }
}
