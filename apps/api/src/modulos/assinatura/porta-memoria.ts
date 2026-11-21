// Porta da assinatura ICP em memória (M49, etapa 1): a sessão sintética de dev/ci (E2E). Os mesmos registros da porta própria em
// listas, com as mesmas recusas (certificado repetido, versão desatualizada, provedor repetido, pedido de uso único).
// A identidade de todo login é a do CPF SINTÉTICO da sessão (nunca de pessoa real); as formas são AD-RB e AD-RT; os
// tipos de certificado e os conselhos, os nomes do cadastro do pc (sem dado de pessoa).
import { CPF_SINTETICO_SESSAO, prioridadeIcp } from '@sgh/dominio-documento';
import {
  type DocumentoAssinadoIcp,
  type AssinaturaDoDocumento,
  type AssinaturaRealizada,
  type AvisoAssinatura,
  type AvisoParaGravar,
  type ConsultaPublicaParaGravar,
  type DocumentoNaFilaIcp,
  type DocumentoVerificado,
  type ResumoVerificacoes,
  type DocumentoEmitidoIcp,
  type PreviaDoDocumento,
  type PedidoNumeracao,
  type PedidoNumeracaoParaGravar,
  TIPOS_DOCUMENTO_ICP,
  type AssinaturaParaGravar,
  type CertificadoVinculado,
  ErroAssinatura,
  type TrilhaAssinatura,
  type PedidoAssinaturaAberto,
  type PedidoAssinaturaParaGravar,
  type PoliticaVigente,
  type PoliticaParaGravar,
  type ProvedorNuvem,
  type ValidacaoParaGravar,
} from './tipos.js';
import type { GravadorAssinatura, PortaAssinaturaIcp } from './porta.js';

/** Uma linha da trilha como a tela a vê (os campos dos dados da linha, mais a tabela, o id e o resultado). */
export interface VistaTrilha {
  readonly entidade: string;
  readonly entidadeId: number | null;
  readonly usuario: number | null;
  readonly evento: string | null;
  readonly recurso: string | null;
  readonly operacao: string | null;
  readonly chave: string | null;
  readonly estacao: string | null;
  readonly ator: string | null;
  readonly resultado: 'sucesso' | 'falha';
}

export function vistaDaTrilha(l: TrilhaAssinatura): VistaTrilha {
  const d = (l.dadosDepois ?? {}) as Record<string, unknown>;
  const t = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  return {
    entidade: l.entidade,
    entidadeId: l.entidadeId,
    usuario: l.usuario,
    evento: t('evento'),
    recurso: t('recurso'),
    operacao: t('operacao'),
    chave: t('chave'),
    estacao: t('estacao'),
    ator: t('ator'),
    resultado: l.resultado ?? 'sucesso',
  };
}

interface CertMem extends CertificadoVinculado {
  readonly certificadoDer: string;
}

/**
 * Os documentos do prontuário da sessão sintética (a porta em memória do prontuário de uso diário, M23): a fila do autor lê
 * deles, e a assinatura ICP marca o evento "assinado" neles (na mesma gravação).
 */
export interface DocumentosMemoriaIcp {
  todos(hospital: string): readonly DocumentoEmitidoIcp[];
  marcarAssinadoIcp(hospital: string, documento: number): void;
}

type AssinMem = AssinaturaParaGravar & {
  id: number;
  criadoEm: string;
  atualizadoEm: string | null;
};

export class PortaAssinaturaMemoria implements PortaAssinaturaIcp {
  readonly destino = 'memoria' as const;
  /** As linhas da trilha gravadas, na vista da tela (evento, recurso, chave e estação vêm dos dados da linha). */
  readonly trilhas: VistaTrilha[] = [];
  private seq = 0;
  private readonly certs: CertMem[] = [];
  private readonly pols: (PoliticaVigente & { hospital: string })[] = [];
  private readonly provs: (ProvedorNuvem & { hospital: string })[] = [];
  private readonly pedidos: (PedidoAssinaturaAberto & { consumido: boolean })[] = [];
  private readonly assins: AssinMem[] = [];
  private readonly valids: (ValidacaoParaGravar & { id: number })[] = [];
  private readonly previas: PreviaDoDocumento[] = [];
  private readonly pdfs = new Map<
    number,
    { previa: number; chaveS3: string | null; versaoS3: string | null; hashPdf: string | null }
  >();
  private readonly avisosMem: (AvisoParaGravar & { id: number; criadoEm: string; lidoEm: string | null })[] =
    [];
  private readonly sncr: (PedidoNumeracaoParaGravar & PedidoNumeracao)[] = [];
  readonly numerosSncr = new Map<string, string>();
  /** Etapa 3: as consultas ao verificador público (consulta_verificacao_documento), com o instante. */
  readonly verificacoes: (ConsultaPublicaParaGravar & { id: number; em: Date })[] = [];

  constructor(private readonly documentos: DocumentosMemoriaIcp | null = null) {}

  private novo() {
    return ++this.seq;
  }

  private gravador(): GravadorAssinatura {
    return {
      gravarCertificado: async (c) => {
        if (
          this.certs.some(
            (x) =>
              x.hospital === c.hospital &&
              x.usuario === c.usuario &&
              x.serie === c.serie &&
              x.emissorHash === c.emissorHash,
          )
        )
          throw new ErroAssinatura(
            'certificado-ja-vinculado',
            'Este certificado já está vinculado à sua conta.',
          );
        const id = this.novo();
        this.certs.push({
          ...c,
          id,
          validoDe: c.validoDe.toISOString(),
          validoAte: c.validoAte.toISOString(),
          ativo: true,
          criadoEm: new Date().toISOString(),
        });
        return { id };
      },
      inativarCertificado: async (d) => {
        const i = this.certs.findIndex(
          (x) => x.hospital === d.hospital && x.usuario === d.usuario && x.id === d.id && x.ativo,
        );
        if (i < 0) return false;
        this.certs[i] = { ...this.certs[i]!, ativo: false };
        return true;
      },
      gravarPolitica: async (p: PoliticaParaGravar) => {
        const id = this.novo();
        this.pols.push({ ...p, id, criadoEm: new Date().toISOString() });
        return { id };
      },
      gravarProvedor: async (p, versao) => {
        const i = this.provs.findIndex((x) => x.hospital === p.hospital && x.codigo === p.codigo);
        if (versao === null) {
          if (i >= 0)
            throw new ErroAssinatura('provedor-repetido', 'Já existe um provedor com este código.');
          const id = this.novo();
          this.provs.push({ ...p, id, versao: 1, alteradoPor: p.por, alteradoEm: p.em.toISOString() });
          return { id, versao: 1 };
        }
        const atual = this.provs[i];
        if (!atual || atual.versao !== versao)
          throw new ErroAssinatura(
            'versao-desatualizada',
            'O provedor foi alterado por outra pessoa. Abra de novo.',
          );
        this.provs[i] = {
          ...atual,
          ...p,
          segredoRef: atual.segredoRef,
          versao: versao + 1,
          alteradoPor: p.por,
          alteradoEm: p.em.toISOString(),
        };
        return { id: atual.id, versao: versao + 1 };
      },
      gravarPedido: async (p: PedidoAssinaturaParaGravar) => {
        if (this.pedidos.some((x) => x.stateHash === p.stateHash))
          throw new ErroAssinatura('pedido-repetido', 'Pedido de assinatura repetido.');
        const id = this.novo();
        this.pedidos.push({ ...p, id, expiraEm: p.expiraEm.toISOString(), consumido: false });
        return { id };
      },
      consumirPedido: async (stateHash, dono, agora) => {
        const p = this.pedidos.find(
          (x) =>
            x.stateHash === stateHash &&
            x.hospital === dono.hospital &&
            x.usuario === dono.usuario &&
            !x.consumido,
        );
        if (!p) return null;
        p.consumido = true;
        const resto = { ...p } as Partial<typeof p>;
        delete resto.consumido;
        return {
          ...(resto as PedidoAssinaturaAberto),
          vencido: new Date(p.expiraEm).getTime() <= agora.getTime(),
        };
      },
      gravarAssinatura: async (a) => {
        const id = this.novo();
        this.assins.push({ ...a, id, criadoEm: new Date().toISOString(), atualizadoEm: null });
        return { id };
      },
      gravarValidacao: async (v) => {
        const id = this.novo();
        this.valids.push({ ...v, id });
        return { id };
      },
      gravarPrevia: async (p) => {
        if (this.previas.some((x) => x.codigo === p.codigo))
          throw new Error('Código de verificação repetido.');
        const id = this.novo();
        this.previas.push({ ...p, id, criadoEm: new Date().toISOString() });
        return { id };
      },
      gravarAssinaturaPdf: async (a) => {
        this.pdfs.set(a.assinatura, { previa: a.previa, chaveS3: null, versaoS3: null, hashPdf: null });
      },
      registrarPdfAssinado: async (a) => {
        const x = this.pdfs.get(a.assinatura);
        if (!x || x.chaveS3) return false;
        this.pdfs.set(a.assinatura, { ...x, chaveS3: a.chaveS3, versaoS3: a.versaoS3, hashPdf: a.hashPdf });
        return true;
      },
      atualizarAssinatura: async (a, agora) => {
        const i = this.assins.findIndex(
          (x) =>
            x.id === a.id &&
            x.hospital === a.hospital &&
            x.estado === a.estadoLido &&
            x.tentativas === a.tentativasLidas,
        );
        if (i < 0) return false;
        const x = this.assins[i]!;
        this.assins[i] = {
          ...x,
          estado: a.estado,
          tentativas: a.tentativas,
          falha: a.falha,
          proximaEm: a.proximaEm,
          carimboToken: a.carimboToken ?? x.carimboToken,
          carimboEm: a.carimboEm ?? x.carimboEm,
          carimboSerie: a.carimboSerie ?? x.carimboSerie,
          atualizadoEm: agora.toISOString(),
        };
        return true;
      },
      travarDocumentoParaAssinar: async (hospital, documento, exceto) => {
        const outras = this.assins.filter(
          (a) =>
            a.hospital === hospital &&
            a.origem === 'documento' &&
            a.documento === documento &&
            a.id !== exceto &&
            (a.estado === 'assinada' || a.estado === 'pendente'),
        );
        return outras.some((a) => a.estado === 'assinada') ? 'assinada' : outras.length ? 'pendente' : null;
      },
      gravarEventoAssinadoIcp: async (ctx, documento) => {
        this.documentos?.marcarAssinadoIcp(ctx.hospital, documento);
      },
      gravarAviso: async (a) => {
        const id = this.novo();
        this.avisosMem.push({ ...a, id, criadoEm: new Date().toISOString(), lidoEm: null });
        return { id };
      },
      marcarAvisosLidos: async (hospital, avisos, por, agora) => {
        let n = 0;
        for (const v of this.avisosMem)
          if (
            v.hospital === hospital &&
            avisos.includes(v.id) &&
            v.lidoEm === null &&
            ((v.destinatario === 'autor' && v.usuario === por.login) ||
              (por.diretorTecnico && v.destinatario === 'diretor-tecnico'))
          ) {
            v.lidoEm = agora.toISOString();
            n++;
          }
        return n;
      },
      gravarSolicitacaoSncr: async (x) => {
        const id = this.novo();
        this.sncr.push({ ...x, id, situacao: 'pendente', tentativas: 0, numero: null, retorno: null });
        return { id };
      },
      atualizarSolicitacaoSncr: async (x) => {
        const s = this.sncr.find(
          (y) => y.id === x.id && y.hospital === x.hospital && y.situacao === 'pendente',
        );
        if (!s) return false;
        Object.assign(s, {
          situacao: x.situacao,
          tentativas: x.tentativas,
          numero: x.numero,
          retorno: x.retorno,
        });
        return true;
      },
      gravarNumeroSncr: async (hospital, documento, numero) => {
        const k = `${hospital}:${documento}`;
        if (this.numerosSncr.has(k)) return false;
        this.numerosSncr.set(k, numero);
        return true;
      },
      registrarConsultaPublica: async (c) => {
        const id = this.novo();
        this.verificacoes.push({ ...c, id, em: new Date() });
        return { id };
      },
    };
  }

  async gravar<T>(
    _c: { rede: string; hospital: string },
    fn: (g: GravadorAssinatura) => Promise<T>,
    trilha: TrilhaAssinatura | ((r: T) => TrilhaAssinatura | null) | null,
  ): Promise<T> {
    const r = await fn(this.gravador());
    const linha = typeof trilha === 'function' ? trilha(r) : trilha;
    if (linha) this.trilhas.push(vistaDaTrilha(linha));
    return r;
  }

  async identidade() {
    return {
      cpf: CPF_SINTETICO_SESSAO,
      cpfProfissional: CPF_SINTETICO_SESSAO,
      registros: [{ cbo: '225125', sigla: 'CRM', uf: 'RJ', numero: '000000' }],
    };
  }

  async formasIcp() {
    return [
      { id: 1, descricao: 'AD-RB', politica: 'AD-RB' as const },
      { id: 2, descricao: 'AD-RT', politica: 'AD-RT' as const },
    ];
  }

  async tiposCertificado() {
    return [
      { id: 1, nome: 'Black Box', ativo: true },
      { id: 2, nome: 'SafeWeb', ativo: true },
      { id: 3, nome: 'Vidaas', ativo: true },
    ];
  }

  async conselhos() {
    return ['CRM', 'COREN', 'CRF', 'CRO', 'CRP', 'CREFITO', 'CRN', 'CRFA', 'CRBM'];
  }

  async certificados(c: { hospital: string }, login: string): Promise<CertificadoVinculado[]> {
    return this.certs
      .filter((x) => x.hospital === c.hospital && x.usuario === login)
      .sort((a, b) => b.id - a.id)
      .map((x) => ({ ...x, certificadoDer: null }));
  }

  async certificado(c: { hospital: string }, id: number) {
    return this.certs.find((x) => x.hospital === c.hospital && x.id === id) ?? null;
  }

  async politicas(c: { hospital: string }): Promise<PoliticaVigente[]> {
    const vistos = new Set<string>();
    const r: PoliticaVigente[] = [];
    for (const p of [...this.pols].filter((x) => x.hospital === c.hospital).sort((a, b) => b.id - a.id)) {
      const k = `${p.tipoDocumento}|${p.conselho ?? ''}|${p.destino}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      if (p.ativa) {
        const resto: Partial<typeof p> = { ...p };
        delete resto.hospital;
        r.push(resto as PoliticaVigente);
      }
    }
    return r.sort((a, b) => a.tipoDocumento.localeCompare(b.tipoDocumento) || a.id - b.id);
  }

  async provedores(c: { hospital: string }): Promise<ProvedorNuvem[]> {
    return this.provs
      .filter((x) => x.hospital === c.hospital)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async provedor(c: { hospital: string }, codigo: string) {
    return this.provs.find((x) => x.hospital === c.hospital && x.codigo === codigo) ?? null;
  }

  async assinaturas(
    c: { hospital: string },
    login: string,
    origem: 'teste' | 'documento',
  ): Promise<AssinaturaRealizada[]> {
    return this.assins
      .filter((a) => a.hospital === c.hospital && a.usuario === login && a.origem === origem)
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map((a) => {
        const v = this.valids.filter((x) => x.assinatura === a.id).sort((x, y) => y.id - x.id)[0];
        return {
          id: a.id,
          origem: a.origem,
          documento: a.documento,
          hash: a.hash,
          politicaIcp: a.politicaIcp,
          midia: a.midia,
          provedor: a.provedor,
          certificado: a.certificado,
          estado: a.estado,
          tentativas: a.tentativas,
          falha: a.falha,
          carimboEm: a.carimboEm?.toISOString() ?? null,
          criadoEm: a.criadoEm,
          validacao: v
            ? {
                resultado: v.resultado,
                em: v.em.toISOString(),
                cadeia: v.cadeia,
                vigencia: v.vigencia,
                revogacao: v.revogacao,
                cpf: v.cpf,
                assinaturaConfere: v.assinaturaConfere,
                carimbo: v.carimbo,
                motivos: v.motivos,
              }
            : null,
        };
      });
  }

  // ── Etapa 2: documentos emitidos ────────────────────────────────────────────────────────────────────────

  async documentoEmitido(c: { hospital: string }, id: number): Promise<DocumentoEmitidoIcp | null> {
    return this.documentos?.todos(c.hospital).find((d) => d.id === id) ?? null;
  }

  private ultimaDoDocumento(hospital: string, documento: number): AssinMem | undefined {
    const ds = this.assins.filter(
      (a) => a.hospital === hospital && a.origem === 'documento' && a.documento === documento,
    );
    return ds.find((a) => a.estado === 'assinada') ?? ds.sort((a, b) => b.id - a.id)[0];
  }

  async filaIcp(c: { hospital: string }, login: string, teto: number, tiposIcp: readonly string[]) {
    const tipos = new Set<string>(TIPOS_DOCUMENTO_ICP);
    const icp = new Set(tiposIcp);
    const itens: DocumentoNaFilaIcp[] = [];
    for (const d of this.documentos?.todos(c.hospital) ?? []) {
      if (d.usuario !== login || !tipos.has(d.tipo) || d.suspenso) continue;
      const a = this.ultimaDoDocumento(c.hospital, d.id);
      // Como o SQL: a pendente e a em falha sempre; sem assinatura, só os tipos que a política manda assinar com ICP.
      if (a ? a.estado === 'assinada' : !icp.has(d.tipo)) continue;
      itens.push({
        documento: d.id,
        tipo: d.tipo,
        paciente: d.paciente,
        criadoEm: d.criadoEm ?? '',
        assinatura: a?.id ?? null,
        estado: a ? (a.estado as 'pendente' | 'falha') : null,
        tentativas: a?.tentativas ?? 0,
        falha: a?.falha ?? null,
        proximaEm: a?.proximaEm?.toISOString() ?? null,
      });
    }
    itens.sort((a, b) => prioridadeIcp(a.tipo) - prioridadeIcp(b.tipo) || a.documento - b.documento);
    return { itens: itens.slice(0, teto), limitado: itens.length > teto };
  }

  async assinaturasDosDocumentos(c: { hospital: string }, documentos: readonly number[]) {
    const m = new Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>();
    for (const d of documentos) {
      const a = this.ultimaDoDocumento(c.hospital, d);
      if (a) m.set(d, { id: a.id, estado: a.estado });
    }
    return m;
  }

  async previaMaisRecente(c: { hospital: string }, documento: number, login: string) {
    return (
      this.previas
        .filter((p) => p.hospital === c.hospital && p.documento === documento && p.usuario === login)
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }

  async previa(c: { hospital: string }, id: number) {
    return this.previas.find((p) => p.hospital === c.hospital && p.id === id) ?? null;
  }

  async assinaturaDocumento(c: { hospital: string }, id: number): Promise<AssinaturaDoDocumento | null> {
    const a = this.assins.find((x) => x.hospital === c.hospital && x.id === id && x.origem === 'documento');
    if (!a) return null;
    const p = this.pdfs.get(a.id);
    return {
      id: a.id,
      hospital: a.hospital,
      documento: a.documento ?? 0,
      hash: a.hash,
      politicaIcp: a.politicaIcp,
      midia: a.midia,
      provedor: a.provedor,
      certificado: a.certificado,
      usuario: a.usuario,
      estado: a.estado,
      tentativas: a.tentativas,
      falha: a.falha,
      proximaEm: a.proximaEm?.toISOString() ?? null,
      assinatura: a.assinatura,
      carimboToken: a.carimboToken,
      carimboEm: a.carimboEm?.toISOString() ?? null,
      criadoEm: a.criadoEm,
      previa: p?.previa ?? null,
      pdf:
        p?.chaveS3 && p.versaoS3 && p.hashPdf
          ? { chaveS3: p.chaveS3, versaoS3: p.versaoS3, hashPdf: p.hashPdf }
          : null,
    };
  }

  async pendentesVencidas(c: { hospital: string }, agora: Date, teto: number) {
    return this.assins
      .filter(
        (a) =>
          a.hospital === c.hospital &&
          a.origem === 'documento' &&
          a.estado === 'pendente' &&
          a.proximaEm !== null &&
          a.proximaEm <= agora,
      )
      .sort((a, b) => a.proximaEm!.getTime() - b.proximaEm!.getTime() || a.id - b.id)
      .slice(0, teto)
      .map((a) => ({ id: a.id, usuario: a.usuario }));
  }

  async assinadosRecentes(c: { hospital: string }, login: string): Promise<DocumentoAssinadoIcp[]> {
    const docs = new Map((this.documentos?.todos(c.hospital) ?? []).map((d) => [d.id, d]));
    return this.assins
      .filter(
        (a) =>
          a.hospital === c.hospital &&
          a.usuario === login &&
          a.origem === 'documento' &&
          a.estado === 'assinada',
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map((a) => {
        const p = this.pdfs.get(a.id);
        const pv = p ? this.previas.find((x) => x.id === p.previa) : undefined;
        const v = this.valids.filter((x) => x.assinatura === a.id).sort((x, y) => y.id - x.id)[0];
        const d = docs.get(a.documento ?? 0);
        return {
          assinatura: a.id,
          documento: a.documento ?? 0,
          tipo: d?.tipo ?? '',
          paciente: d?.paciente ?? 0,
          politicaIcp: a.politicaIcp,
          assinadoEm: a.atualizadoEm ?? a.criadoEm,
          carimboEm: a.carimboEm?.toISOString() ?? null,
          codigo: pv?.codigo ?? null,
          temPdf: !!p?.chaveS3,
          resultado: v?.resultado ?? null,
        };
      });
  }

  async contagemPendencias(c: { hospital: string }) {
    const assinados = new Set(
      this.assins.filter((a) => a.hospital === c.hospital && a.estado === 'assinada').map((a) => a.documento),
    );
    const abertas = this.assins.filter(
      (a) => a.hospital === c.hospital && a.origem === 'documento' && !assinados.has(a.documento),
    );
    return {
      pendentes: abertas.filter((a) => a.estado === 'pendente').length,
      falhas: abertas.filter((a) => a.estado === 'falha').length,
    };
  }

  async avisos(
    c: { hospital: string },
    para: { autor: string } | 'diretor-tecnico',
  ): Promise<AvisoAssinatura[]> {
    return this.avisosMem
      .filter(
        (v) =>
          v.hospital === c.hospital &&
          v.lidoEm === null &&
          (para === 'diretor-tecnico'
            ? v.destinatario === 'diretor-tecnico'
            : v.destinatario === 'autor' && v.usuario === para.autor),
      )
      .sort((a, b) => b.id - a.id)
      .map((v) => {
        const a = this.assins.find((x) => x.id === v.assinatura);
        return {
          id: v.id,
          assinatura: v.assinatura,
          documento: a?.documento ?? null,
          destinatario: v.destinatario,
          estado: v.estado,
          falha: v.falha,
          autor: a?.usuario ?? '',
          criadoEm: v.criadoEm,
        };
      });
  }

  async oidsDeConselho() {
    return [];
  }

  // ── Etapa 3: verificador público ──

  async documentoDoCodigo(c: { hospital: string }, codigo: string): Promise<DocumentoVerificado | null> {
    const pv = this.previas.find((p) => p.hospital === c.hospital && p.codigo === codigo);
    if (!pv) return null;
    const d = (this.documentos?.todos(c.hospital) ?? []).find((x) => x.id === pv.documento);
    const idAssin = [...this.pdfs.entries()].find(([, p]) => p.previa === pv.id)?.[0];
    const a = idAssin ? this.assins.find((x) => x.id === idAssin && x.origem === 'documento') : undefined;
    const v = a ? this.valids.filter((x) => x.assinatura === a.id).sort((x, y) => y.id - x.id)[0] : undefined;
    return {
      previa: pv.id,
      documento: pv.documento,
      tipo: d?.tipo ?? '',
      emitidoEm: d?.criadoEm ?? null,
      suspenso: d?.suspenso ?? false,
      politicaIcp: pv.politicaIcp,
      assinarEm: pv.assinarEm,
      profissional: pv.profissional ?? null,
      registro: pv.registro ?? null,
      assinatura: a
        ? {
            id: a.id,
            estado: a.estado,
            carimboEm: a.carimboEm?.toISOString() ?? null,
            hashPdf: this.pdfs.get(a.id)?.hashPdf ?? null,
          }
        : null,
      validacao: v ? { resultado: v.resultado, momento: v.momento, em: v.em.toISOString() } : null,
    };
  }

  async resumoVerificacoes(c: { hospital: string }, desde: Date): Promise<ResumoVerificacoes[]> {
    const m = new Map<string, number>();
    for (const v of this.verificacoes)
      if (v.hospital === c.hospital && v.em >= desde) {
        const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(v.em);
        const k = `${dia}|${v.resultado}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return [...m.entries()]
      .map(([k, n]) => {
        const [dia = '', resultado = ''] = k.split('|');
        return { dia, resultado: resultado as ResumoVerificacoes['resultado'], consultas: n };
      })
      .sort((a, b) => b.dia.localeCompare(a.dia) || a.resultado.localeCompare(b.resultado));
  }

  async solicitacoesSncr(c: { hospital: string }, documento: number): Promise<PedidoNumeracao[]> {
    return this.sncr
      .filter((x) => x.hospital === c.hospital && x.documento === documento)
      .sort((a, b) => b.id - a.id)
      .map((x) => ({
        id: x.id,
        documento: x.documento,
        situacao: x.situacao,
        tentativas: x.tentativas,
        numero: x.numero,
        retorno: x.retorno,
      }));
  }
}
