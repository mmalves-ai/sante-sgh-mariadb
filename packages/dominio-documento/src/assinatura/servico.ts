// Núcleo do serviço de assinatura isolado (M49; regras 1, 2, 4, 6 e 7; ICP-01, SBIS-30, SBIS-35, ICP-02): decide,
// para cada documento pedido, se vai ao provedor ou é recusado, ANTES de qualquer chamada externa. O documento não sai
// do servidor: o que vai é o hash do PDF/A emitido (o mesmo que a prévia mostrou). O serviço que roda isto não tem a
// chave privada (fica no PSC ou no agente local) e não tem o segredo do PSC fora do cofre. Puro: o chamador traz a
// prova do documento (SGH_PEP_DOCUMENTO/SGH_PEP_DOC), o certificado vinculado lido e as regras de política.
import type {
  ExigenciaAssinatura,
  MidiaCertificado,
  MotivoRecusaAssinatura,
  PoliticaAssinaturaIcp,
} from '@sgh/contratos';
import { conferirCpf, type CertificadoLido } from './certificado.js';
import { tipoPelaPolitica } from './oids.js';
import { resolverExigencia, type DocumentoParaPolitica, type RegraPoliticaAssinatura } from './politica.js';

/** O documento como o novo emitiu: só existe para documento com prova (regra 7: o do outro sistema não tem). */
export interface DocumentoEmitido extends DocumentoParaPolitica {
  readonly id: number;
  /** SHA-256 do PDF/A emitido (o que a prévia mostrou e o que será assinado). */
  readonly hash: string;
  /** Login do autor. */
  readonly autor: string;
  readonly jaAssinadoIcp: boolean;
}

export interface CertificadoParaAssinar {
  readonly midia: MidiaCertificado;
  readonly lido: CertificadoLido;
  readonly ativo: boolean;
}

export interface PedidoPlanejado {
  readonly documentos: readonly number[];
  readonly hashes: readonly string[];
}

export interface ItemPlanejado {
  readonly documento: number;
  readonly hash: string;
  readonly exigencia: ExigenciaAssinatura;
}

export interface PlanoAssinatura {
  readonly aAssinar: readonly ItemPlanejado[];
  readonly recusados: readonly { readonly documento: number; readonly motivo: MotivoRecusaAssinatura }[];
  /** Pelo menos um item pede carimbo do tempo: o serviço chama a ACT depois da assinatura. */
  readonly pedeCarimbo: boolean;
  /** Política da assinatura a aplicar no lote (a mais forte exigida entre os itens). */
  readonly politica: PoliticaAssinaturaIcp;
}

/**
 * Planeja a assinatura do pedido. Recusa o lote inteiro quando o CERTIFICADO não serve (CPF, vigência, ICP, uso da
 * chave); recusa item a item quando o DOCUMENTO não serve (sem prova, outro autor, já assinado, prévia diferente).
 */
export function planejarAssinatura(entrada: {
  readonly pedido: PedidoPlanejado;
  /** Documentos encontrados por ID (os do outro sistema não aparecem aqui: não têm prova). */
  readonly documentos: ReadonlyMap<number, DocumentoEmitido>;
  readonly usuario: { readonly login: string; readonly cpf: string | number | bigint | null };
  readonly certificado: CertificadoParaAssinar;
  readonly regras: readonly RegraPoliticaAssinatura[];
  readonly agora: Date;
}): PlanoAssinatura {
  const { pedido, certificado: c, agora } = entrada;
  const todos = (motivo: MotivoRecusaAssinatura): PlanoAssinatura => ({
    aAssinar: [],
    recusados: pedido.documentos.map((documento) => ({ documento, motivo })),
    pedeCarimbo: false,
    politica: 'AD-RB',
  });
  if (!c.ativo) return todos('provedor-desligado');
  const cpf = conferirCpf(c.lido, entrada.usuario.cpf);
  if (!cpf.ok) return todos(cpf.motivo);
  if (agora < c.lido.validoDe || agora > c.lido.validoAte) return todos('certificado-fora-da-vigencia');
  if (tipoPelaPolitica(c.lido.politicas) === null) return todos('certificado-fora-da-icp');
  if (!c.lido.usoDaChave?.assinaturaDigital || !c.lido.usoDaChave.naoRepudio) return todos('uso-da-chave');

  const aAssinar: ItemPlanejado[] = [];
  const recusados: { documento: number; motivo: MotivoRecusaAssinatura }[] = [];
  pedido.documentos.forEach((id, i) => {
    const d = entrada.documentos.get(id);
    const motivo: MotivoRecusaAssinatura | null = !d
      ? 'documento-sem-prova'
      : d.autor !== entrada.usuario.login
        ? 'nao-e-o-autor'
        : d.jaAssinadoIcp
          ? 'ja-assinado'
          : pedido.hashes[i] !== d.hash
            ? 'hash-divergente'
            : null;
    if (motivo || !d) recusados.push({ documento: id, motivo: motivo ?? 'documento-sem-prova' });
    // A assinatura deste serviço é sempre ICP-Brasil (AD-RT quando algum item pede carimbo): atende qualquer exigência.
    else aAssinar.push({ documento: id, hash: d.hash, exigencia: resolverExigencia(entrada.regras, d) });
  });
  const pedeCarimbo = aAssinar.some((x) => x.exigencia.carimboDoTempo);
  return { aAssinar, recusados, pedeCarimbo, politica: pedeCarimbo ? 'AD-RT' : 'AD-RB' };
}

export interface ProvedorParaConferir {
  readonly codigo: string;
  readonly ativo: boolean;
  readonly midias: readonly MidiaCertificado[];
  readonly autoridades: readonly string[];
}

/**
 * Regra 1 (ICP-02): cada mídia em uso aceita pelo menos `minimo` autoridades certificadoras diferentes, somados os
 * provedores ativos. Devolve as mídias que não cumprem (vazio: o serviço pode ligar).
 */
export function midiasSemAutoridadesSuficientes(
  provedores: readonly ProvedorParaConferir[],
  minimo: number,
): { midia: MidiaCertificado; autoridades: number }[] {
  const por = new Map<MidiaCertificado, Set<string>>();
  for (const p of provedores) {
    if (!p.ativo) continue;
    for (const m of p.midias) {
      const s = por.get(m) ?? new Set<string>();
      for (const a of p.autoridades) s.add(a.trim().toUpperCase());
      por.set(m, s);
    }
  }
  return [...por.entries()]
    .filter(([, s]) => s.size < minimo)
    .map(([midia, s]) => ({ midia, autoridades: s.size }))
    .sort((a, b) => a.midia.localeCompare(b.midia));
}
