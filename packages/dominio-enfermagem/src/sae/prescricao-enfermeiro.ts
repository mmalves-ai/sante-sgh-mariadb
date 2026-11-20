// A prescrição de medicamento pelo enfermeiro (M45, etapa 4; regra 17; Res. COFEN 801/2026): só em consulta de
// enfermagem, só pelo enfermeiro, só com protocolo institucional ou de programa de saúde publicado e só com os
// medicamentos da lista do anexo II (parâmetro versionado) que o protocolo permite. A receita sai com o conteúdo mínimo
// do art. 3º: o protocolo e o ano, a instituição e o CNPJ, o nome, o COREN e a categoria do prescritor, a assinatura, a
// data, o paciente com o segundo identificador e cada medicamento pelo nome genérico com a via e a posologia; modelo
// simples (anexo I-A) ou de retenção (anexo I-B). A impressão SHA-256 do texto é o que a assinatura cobre.
import {
  type CabecalhoReceitaEnfermeiro,
  type ItemReceitaEnfermeiro,
  type ListaAnexoII,
  type ModeloReceitaEnfermeiro,
  type ProtocoloEnfermeiro,
  type SegundoIdentificador,
  sha256Hex,
  TIPOS_PROTOCOLO_ENFERMEIRO,
  type TipoProtocoloEnfermeiro,
} from '@sgh/contratos';
import type { RecusaSae } from './processo.js';

const recusa = (codigo: string, mensagem: string, campo?: string): RecusaSae => ({
  ok: false,
  codigo,
  mensagem,
  ...(campo ? { campo } : {}),
});
const generico = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Os protocolos do parâmetro (`CODIGO/ANO:tipo:genérico,genérico;...`); o que não estiver no formato fica de fora. */
export function lerProtocolosEnfermeiro(valor: string | null | undefined): ProtocoloEnfermeiro[] {
  const saida: ProtocoloEnfermeiro[] = [];
  for (const parte of String(valor ?? '').split(';')) {
    const m = /^\s*([A-Za-z0-9._-]{1,20})\/(\d{4}):(institucional|programa):(.+)$/.exec(parte);
    if (!m) continue;
    const medicamentos = [
      ...new Set(
        m[4]!
          .split(',')
          .map(generico)
          .filter((x) => x.length >= 3),
      ),
    ];
    if (medicamentos.length === 0) continue;
    saida.push({
      codigo: m[1]!,
      ano: Number(m[2]),
      tipo: m[3] as TipoProtocoloEnfermeiro,
      medicamentos,
    });
  }
  return saida;
}

/** A lista do anexo II do parâmetro (`VERSAO=genérico,genérico`); nula fora do formato ou vazia. */
export function lerAnexoII(valor: string | null | undefined): ListaAnexoII | null {
  const m = /^\s*([A-Za-z0-9._-]{1,20})=(.+)$/.exec(String(valor ?? ''));
  if (!m) return null;
  const medicamentos = [
    ...new Set(
      m[2]!
        .split(',')
        .map(generico)
        .filter((x) => x.length >= 3),
    ),
  ];
  return medicamentos.length ? { versao: m[1]!, medicamentos } : null;
}

export interface ReceitaConferida {
  readonly ok: true;
  readonly protocolo: ProtocoloEnfermeiro;
  readonly lista: ListaAnexoII;
  readonly itens: readonly ItemReceitaEnfermeiro[];
}

/**
 * Regra 17: confere a receita — consulta de enfermagem, enfermeiro, protocolo publicado, a lista do anexo II, cada
 * medicamento na lista e no protocolo, sem repetir.
 */
export function conferirReceitaEnfermeiro(
  e: {
    readonly protocolo: string;
    readonly itens: readonly ItemReceitaEnfermeiro[];
  },
  o: {
    readonly consultaDeEnfermagem: boolean;
    readonly enfermeiro: boolean;
    readonly protocolos: readonly ProtocoloEnfermeiro[];
    readonly lista: ListaAnexoII | null;
  },
): ReceitaConferida | RecusaSae {
  if (!o.enfermeiro)
    return recusa('so-enfermeiro', 'A prescrição de medicamento é do enfermeiro com o conselho ativo.');
  if (!o.consultaDeEnfermagem)
    return recusa(
      'fora-da-consulta-de-enfermagem',
      'A prescrição de medicamento pelo enfermeiro é só na consulta de enfermagem (atendimento externo do enfermeiro).',
    );
  if (!o.lista)
    return recusa(
      'sem-lista',
      'A lista de medicamentos do enfermeiro não foi publicada neste estabelecimento.',
    );
  const p = o.protocolos.find((x) => `${x.codigo}/${x.ano}` === e.protocolo);
  if (!p)
    return recusa(
      'protocolo-nao-publicado',
      'O protocolo não está publicado neste estabelecimento.',
      'protocolo',
    );
  if (!TIPOS_PROTOCOLO_ENFERMEIRO.includes(p.tipo))
    return recusa('valor-nunca-visto', 'Tipo de protocolo desconhecido.', 'protocolo');
  const vistos = new Set<string>();
  const itens: ItemReceitaEnfermeiro[] = [];
  for (const [i, x] of e.itens.entries()) {
    const nome = generico(x.medicamento);
    const campo = `itens.${i}.medicamento`;
    if (vistos.has(nome))
      return recusa('medicamento-repetido', 'O mesmo medicamento entrou duas vezes.', campo);
    vistos.add(nome);
    if (!o.lista.medicamentos.includes(nome))
      return recusa(
        'fora-da-lista',
        `"${x.medicamento}" não está na lista de medicamentos do enfermeiro.`,
        campo,
      );
    if (!p.medicamentos.includes(nome))
      return recusa('fora-do-protocolo', `"${x.medicamento}" não está no protocolo ${e.protocolo}.`, campo);
    itens.push({ ...x, medicamento: nome });
  }
  return { ok: true, protocolo: p, lista: o.lista, itens };
}

const ROTULO_MODELO: Record<ModeloReceitaEnfermeiro, string> = {
  simples: 'Receita simples',
  retencao: 'Receita de retenção (duas vias: a primeira fica retida na farmácia)',
};
const ROTULO_TIPO: Record<TipoProtocoloEnfermeiro, string> = {
  institucional: 'Protocolo institucional',
  programa: 'Protocolo de programa de saúde',
};
const ROTULO_SEGUNDO: Record<SegundoIdentificador, string> = {
  cpf: 'CPF',
  nascimento: 'Data de nascimento',
};

/** O texto da receita com o conteúdo mínimo do art. 3º (o que a tela mostra, a impressão cobre e o papel leva). */
export function textoDaReceitaEnfermeiro(
  cab: CabecalhoReceitaEnfermeiro,
  r: {
    readonly protocolo: Pick<ProtocoloEnfermeiro, 'codigo' | 'ano' | 'tipo'>;
    readonly modelo: ModeloReceitaEnfermeiro;
    readonly segundoIdentificador: SegundoIdentificador;
    readonly listaVersao: string;
    readonly itens: readonly ItemReceitaEnfermeiro[];
    /** W0-03: a reemissão cita a receita que substitui (a anterior, suspensa ou cancelada, não é regerada). */
    readonly anterior?: number | null | undefined;
  },
): string {
  const linhas = [
    ROTULO_MODELO[r.modelo],
    ...(r.anterior ? [`Reemissão: substitui a receita nº ${r.anterior}`] : []),
    `${cab.instituicao}${cab.cnpj ? ` · CNPJ ${cab.cnpj}` : ''}`,
    `${ROTULO_TIPO[r.protocolo.tipo]}: ${r.protocolo.codigo}, de ${r.protocolo.ano}`,
    `Paciente: ${cab.paciente} · ${ROTULO_SEGUNDO[r.segundoIdentificador]}: ${cab.segundoIdentificador ?? 'não informado'}`,
    '',
    ...r.itens.flatMap((x, i) => [
      `${i + 1}. ${x.medicamento} · via ${x.via} · ${x.quantidade}`,
      `   ${x.posologia}`,
    ]),
    '',
    `Lista de medicamentos: ${r.listaVersao}`,
    `Data: ${cab.data}`,
    `Prescritor: ${cab.prescritor} · ${cab.categoria} · ${cab.coren ?? 'COREN não informado'}`,
    'Assinatura eletrônica do prescritor',
  ];
  return linhas.join('\n');
}

/** A impressão SHA-256 do texto da receita (a assinatura cobre exatamente este texto). */
export function impressaoDaReceita(texto: string): Promise<string> {
  return sha256Hex(texto);
}

/** O CPF mascarado para a receita (só os 3 primeiros e os 2 últimos dígitos visíveis). */
export function cpfMascarado(cpf: string | null | undefined): string | null {
  const d = String(cpf ?? '').replace(/\D/g, '');
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}
