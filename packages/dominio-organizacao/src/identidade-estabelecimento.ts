// Identidade do estabelecimento (F3.1, 02-CAD linha 26): os logotipos por finalidade de uso e a mantenedora (a pessoa
// jurídica que responde pelo hospital perante os órgãos). Só regra pura: quem lê e grava é a API.
// - logotipo: imagem PNG ou JPEG conferida pelo conteúdo (nunca pelo nome), com teto de tamanho e as dimensões lidas
//   do próprio arquivo; uma finalidade tem um só logotipo ativo (o envio novo aposenta o anterior, que fica no
//   histórico); a sequência nunca é reaproveitada;
// - mantenedora: código, razão social e CNPJ conferido; registros (junta comercial, cartório) com número e data juntos;
//   o registro do contador só com o contador.
import { cnpjConfere } from './gestao-estrutura.js';

export const FINALIDADES_LOGOTIPO = [
  'documento',
  'relatorio',
  'prescricao',
  'etiqueta',
  'tela',
  'email',
  'orgao_publico',
  'portal',
] as const;
export type FinalidadeLogotipo = (typeof FINALIDADES_LOGOTIPO)[number];

/** Até 512 KB: o logotipo é impresso em todo documento e relatório, e viaja em todo e-mail. */
export const TAMANHO_MAXIMO_LOGOTIPO = 512 * 1024;
/** Maior lado aceito (pixels): acima disso é foto, não logotipo. */
export const LADO_MAXIMO_LOGOTIPO = 4000;
/** Menor lado aceito (pixels): abaixo disso sai borrado no papel. */
export const LADO_MINIMO_LOGOTIPO = 16;

export interface ImagemLida {
  readonly tipo: 'image/png' | 'image/jpeg';
  readonly largura: number;
  readonly altura: number;
}

const u16 = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32 = (b: Uint8Array, i: number): number => u16(b, i) * 65536 + u16(b, i + 2);

/**
 * O tipo e as dimensões pelo conteúdo: PNG (cabeçalho com largura e altura) ou JPEG (primeiro quadro). Outro formato,
 * arquivo truncado ou dimensão zero: null.
 */
export function lerImagem(b: Uint8Array): ImagemLida | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 24 && png.every((v, i) => b[i] === v)) {
    // O primeiro bloco é o cabeçalho da imagem (IHDR): largura e altura em 4 bytes cada.
    if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
    const largura = u32(b, 16);
    const altura = u32(b, 20);
    return largura > 0 && altura > 0 ? { tipo: 'image/png', largura, altura } : null;
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marca = b[i + 1] ?? 0;
      if (marca === 0xff) {
        i += 1;
        continue;
      }
      // Marcas sem tamanho (reinício e início de imagem).
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) {
        i += 2;
        continue;
      }
      const tamanho = u16(b, i + 2);
      if (tamanho < 2) return null;
      // Início de quadro (todas as variantes, menos as tabelas 0xC4, 0xC8 e 0xCC): altura e largura em 2 bytes.
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        const altura = u16(b, i + 5);
        const largura = u16(b, i + 7);
        return largura > 0 && altura > 0 ? { tipo: 'image/jpeg', largura, altura } : null;
      }
      i += 2 + tamanho;
    }
    return null;
  }
  return null;
}

/** Recusas do arquivo enviado como logotipo (todas de uma vez). */
export function errosArquivoLogotipo(b: Uint8Array): string[] {
  if (b.length === 0) return ['arquivo-vazio'];
  const erros: string[] = [];
  if (b.length > TAMANHO_MAXIMO_LOGOTIPO) erros.push('arquivo-grande');
  const img = lerImagem(b);
  if (!img) erros.push('arquivo-nao-imagem');
  else {
    if (Math.max(img.largura, img.altura) > LADO_MAXIMO_LOGOTIPO) erros.push('imagem-grande');
    if (Math.min(img.largura, img.altura) < LADO_MINIMO_LOGOTIPO) erros.push('imagem-pequena');
  }
  return erros;
}

export interface DadosLogotipo {
  readonly finalidade: string;
  readonly cabecalhoRelatorio: string | null;
  readonly rodapeRelatorio: string | null;
}

export function errosLogotipo(d: DadosLogotipo): string[] {
  const erros: string[] = [];
  if (!(FINALIDADES_LOGOTIPO as readonly string[]).includes(d.finalidade)) erros.push('finalidade-invalida');
  if ((d.cabecalhoRelatorio ?? '').length > 150) erros.push('cabecalho-longo');
  if ((d.rodapeRelatorio ?? '').length > 150) erros.push('rodape-longo');
  return erros;
}

export interface LogotipoExistente {
  readonly id: number;
  readonly sequencia: number;
  readonly finalidade: string;
  readonly ativo: boolean;
  /** Excluído (exclusão lógica): fica na lista só para a sequência, que nunca é reaproveitada. */
  readonly excluido: boolean;
}

/** A próxima sequência: depois da maior já usada, contando os excluídos (número de logotipo nunca volta). */
export function proximaSequencia(existentes: readonly Pick<LogotipoExistente, 'sequencia'>[]): number {
  return existentes.reduce((m, l) => Math.max(m, l.sequencia), 0) + 1;
}

/** Os logotipos ativos da mesma finalidade que o envio novo aposenta (ficam inativos, no histórico). */
export function aposentadosPeloEnvio(
  existentes: readonly LogotipoExistente[],
  finalidade: string,
): LogotipoExistente[] {
  return existentes.filter((l) => !l.excluido && l.ativo && l.finalidade === finalidade);
}

/**
 * Alterar o logotipo sem trocar a imagem: a finalidade que ficaria com dois ativos é recusada (nunca se desativa o
 * outro em silêncio numa alteração; só o envio de imagem nova substitui).
 */
export function errosAlterarLogotipo(
  existentes: readonly LogotipoExistente[],
  alvo: { readonly id: number; readonly finalidade: string; readonly ativo: boolean },
): string[] {
  const eu = existentes.find((l) => l.id === alvo.id);
  if (!eu || eu.excluido) return ['logotipo-inexistente'];
  if (!alvo.ativo) return [];
  return existentes.some(
    (l) => l.id !== alvo.id && !l.excluido && l.ativo && l.finalidade === alvo.finalidade,
  )
    ? ['finalidade-com-logotipo-ativo']
    : [];
}

// ── Mantenedora ──

export const TIPOS_DECLARANTE = ['prestador_saude', 'operadora', 'prestador_e_operadora'] as const;
export type TipoDeclarante = (typeof TIPOS_DECLARANTE)[number];

export interface DadosMantenedora {
  readonly codigo: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly cnpj: string;
  readonly inscricaoEstadual: string | null;
  readonly inscricaoMunicipal: string | null;
  /** Número de registro na junta comercial (11 dígitos) e a data. */
  readonly nire: string | null;
  readonly dataRegistroNire: string | null;
  /** Registro em cartório de pessoa jurídica (entidade sem fins lucrativos) e a data. */
  readonly registroCivil: string | null;
  readonly dataRegistroCivil: string | null;
  /** Atividade econômica principal (7 dígitos). */
  readonly cnaePrincipal: string | null;
  /** Registro na agência de saúde suplementar (6 dígitos), quando opera plano próprio. */
  readonly registroAns: string | null;
  readonly tipoDeclarante: string | null;
  readonly responsavel: number | null;
  readonly contador: number | null;
  readonly contadorCrc: string | null;
  readonly site: string | null;
}

const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Recusas da mantenedora (todas de uma vez). `hoje` (AAAA-MM-DD) barra data de registro no futuro. */
export function errosMantenedora(d: DadosMantenedora, hoje: string): string[] {
  const erros: string[] = [];
  if (!CODIGO.test(d.codigo)) erros.push('codigo-invalido');
  if (d.razaoSocial.trim() === '') erros.push('razao-social-vazia');
  if (!cnpjConfere(d.cnpj)) erros.push('cnpj-invalido');
  if (d.nire !== null && !/^\d{11}$/.test(d.nire)) erros.push('nire-invalido');
  if (d.nire === null && d.dataRegistroNire !== null) erros.push('data-nire-sem-numero');
  if (d.registroCivil === null && d.dataRegistroCivil !== null) erros.push('data-registro-civil-sem-numero');
  for (const [dia, erro] of [
    [d.dataRegistroNire, 'data-nire-invalida'],
    [d.dataRegistroCivil, 'data-registro-civil-invalida'],
  ] as const)
    if (dia !== null && (!DIA.test(dia) || dia > hoje)) erros.push(erro);
  if (d.cnaePrincipal !== null && !/^\d{7}$/.test(d.cnaePrincipal)) erros.push('cnae-invalido');
  if (d.registroAns !== null && !/^\d{6}$/.test(d.registroAns)) erros.push('registro-ans-invalido');
  if (d.tipoDeclarante !== null && !(TIPOS_DECLARANTE as readonly string[]).includes(d.tipoDeclarante))
    erros.push('tipo-declarante-invalido');
  // Quem declara como operadora tem registro na agência.
  if (
    (d.tipoDeclarante === 'operadora' || d.tipoDeclarante === 'prestador_e_operadora') &&
    d.registroAns === null
  )
    erros.push('operadora-sem-registro-ans');
  if (d.contador === null && d.contadorCrc !== null) erros.push('crc-sem-contador');
  if (d.contador !== null && d.contador === d.responsavel) erros.push('contador-igual-responsavel');
  if (d.site !== null && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(d.site))
    erros.push('site-invalido');
  return erros;
}

/** Só se inativa a mantenedora que nenhum estabelecimento ativo usa. */
export function errosInativarMantenedora(estabelecimentosLigados: number): string[] {
  return estabelecimentosLigados > 0 ? ['mantenedora-em-uso'] : [];
}
