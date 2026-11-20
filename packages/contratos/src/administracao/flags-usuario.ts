// W1-01 (parte 3b): permissões complementares do usuário (TBUSUCPL, uma linha por empresa) que o Sante altera pela
// receita acesso.alterarFlagsUsuario. Cada coluna grava a letra que o legado já grava nela: as letras vistas no perfil
// passivo do pc (packages/legado/src/acesso/assinaturas/dominios-vistos.json, todo o período). "FT": liga e desliga;
// "F": só desliga (ninguém ligou neste estabelecimento: ligar gravaria uma letra nunca vista); "T": só liga.
// Fora da lista (32 colunas de uma letra): PRTANT (não é permissão: marca do prontuário anterior) e as colunas cujo
// domínio o perfil não exporta (restrição de dado pessoal) ou nunca teve letra: aparecem na ficha só com o valor.
// A lista é conferida contra o JSON pelo teste do legado (flags-usuario.spec.ts).
import { z } from 'zod';
import { esquemaLogin } from '../acesso/entrada.js';

export const LETRAS_FLAGS_USUCPL: Readonly<Record<string, 'FT' | 'F' | 'T'>> = {
  TOT_MEM: 'FT',
  CRIAR_NF: 'FT',
  MAN_NF: 'F',
  EMI_NF: 'F',
  EXCPAC: 'FT',
  EXCATE: 'FT',
  RX: 'FT',
  LAB: 'FT',
  ANA: 'F',
  ENDO: 'FT',
  TOMO: 'FT',
  ULTRA: 'FT',
  RES: 'FT',
  EXCAGE: 'FT',
  EXC_DOC: 'FT',
  EXC_CHE: 'F',
  ICN: 'FT',
  CAN_APRES: 'FT',
  CAN_FECH: 'FT',
  ACE_ALTA: 'FT',
  EXCAGESADT: 'FT',
  EXCATESADT: 'FT',
  INC_APRES_AMB: 'F',
  INC_FECH_AMB: 'F',
  CAN_APRES_AMB: 'F',
  CAN_FECH_AMB: 'F',
  LIB_RES: 'FT',
  CONS_RES: 'FT',
  LAN_EXTRAS: 'FT',
  INCEXCHR: 'FT',
  SITUACAO: 'FT',
  AUTPRCREG: 'F',
  CANAGEREG: 'F',
  ALTER_RES_SADT: 'F',
  ACOESAGE: 'FT',
  AUT_ELET: 'FT',
  AUT_DOC: 'F',
  LIBHOR: 'FT',
  REAUDITAR: 'FT',
  SO_REEM_REL_RES_LAB: 'FT',
  LIBPLS: 'FT',
  EXCATESUS: 'FT',
  INCEXCAGEU: 'FT',
  ALT_REM_APRES: 'FT',
  ALTPACREG: 'F',
  OUT: 'FT',
  PLANEJA: 'FT',
  PERM_ABONO: 'F',
  PERM_SUSP_FUNC: 'F',
  PERM_ACERTO_HORA: 'F',
  ALTAPAC: 'FT',
  MENSCONS: 'FT',
  ALTACANC: 'FT',
  ALT_REM_FEC: 'FT',
  EXLANSADT: 'FT',
  ALT_MEM: 'FT',
  SADTLOGADO: 'F',
  EXC_NF: 'F',
  SADTEXCAGENDA: 'FT',
  EXCATECONSNULO: 'FT',
  PACPEND: 'FT',
  MAN_PAR_NF: 'F',
  MANUREP_FISICO: 'F',
  MANUREP_JURIDICO: 'F',
  GERAR_MENSALIDADE: 'F',
  GERAR_BAIXA: 'F',
  MANUTENCAO_MENSALIDADE: 'F',
  CANCELAR_MENSALIDADE: 'F',
  CANCELAR_BAIXA: 'F',
  ABRIR_GUIA_FECHADA: 'F',
  GERAR_DOC_PAGCRED: 'F',
  MUDAR_STATUS_GUIAS: 'F',
  AUDITA_GUIAS: 'F',
  ATU_SALDO_FIN: 'FT',
  MAN_NF_EMITIDA: 'F',
  VISUALIZAR_H: 'FT',
  FISIOTERAPIA: 'FT',
  DIV_SH_GRA: 'FT',
  DIV_SH_EXC: 'FT',
  DIV_SP_GRA: 'FT',
  DIV_SP_EXC: 'FT',
  DIV_RC_GRA: 'FT',
  DIV_RC_EXC: 'FT',
  DIV_MM_GRA: 'T',
  DIV_MM_EXC: 'FT',
  PLS_INT_CONTABIL: 'F',
  EXC_DOC_EST: 'FT',
  OLD_PERM_ALT_RES_LIB: 'T',
  VISANAANT: 'FT',
  MANUCADPLSIMPLANTA: 'F',
  INC_MEM: 'FT',
  EXC_MEM: 'FT',
  ALTERAR_LOCAL_CONSUMO: 'FT',
  BLCDATAHORAATEND: 'FT',
  INC_IRR: 'FT',
  ALT_IRR: 'FT',
  EXC_IRR: 'FT',
  LIBERA_CRITICA_AIH: 'F',
  LAN_VALOR: 'FT',
  LAN_PERC: 'FT',
  ALTERAR_VLR_ORCA_SADT: 'FT',
  ALTA_CONSUMONULO: 'FT',
  CANCELAR_NF: 'FT',
  CRIAR_RECIBO_CONV: 'FT',
  ALTERAR_RECIBO_CONV: 'FT',
  CANCELAR_RECIBO_CONV: 'FT',
  EXCLUIR_RECIBO_CONV: 'FT',
  ALERTAR_BOLSA_VENCIMENTO_HEM: 'F',
  BLOQUEAR_AGE_DT_ANT_ATUAL_PEXT: 'FT',
  GERENCIAR_CTA_POR_UNIDADE_CONV: 'FT',
  CRIAR_SUBCONTA_PARTICULAR_DIV: 'FT',
  ACESSO_ENV_SNH_PAINEL_SADT_MOD2: 'F',
  ACESSO_ENV_SNH_PAINEL_PINT_MOD2: 'F',
  CANCELAR_ATEND_CONTA_EMIT_PEXT: 'F',
  CANCELAR_ATEND_CONTA_EMIT_SADT: 'F',
  INCLUIR_PRE_ATEND_EXT: 'F',
  ALTERAR_PRE_ATEND_EXT: 'F',
  CONSULTAR_PRE_ATEND_EXT: 'F',
  EXCLUIR_PRE_ATEND_EXT: 'F',
  INCLUIR_PRE_ATEND_INT: 'F',
  ALTERAR_PRE_ATEND_INT: 'F',
  CONSULTAR_PRE_ATEND_INT: 'F',
  EXCLUIR_PRE_ATEND_INT: 'F',
  EFD_REINF: 'F',
  FECHAR_REM: 'F',
  CANCELAR_FECH_REM: 'F',
  APRESENTAR_REM: 'F',
  CANCELAR_APRES_REM: 'F',
  LIBERAR_GUICHE_BLOQUEADO: 'F',
};

/** A coluna aceita a mudança pedida (ligar exige o T visto; desligar, o F visto). */
export function flagAceita(coluna: string, ligado: boolean): boolean {
  const l = Object.prototype.hasOwnProperty.call(LETRAS_FLAGS_USUCPL, coluna)
    ? LETRAS_FLAGS_USUCPL[coluna]
    : undefined;
  return l !== undefined && l.includes(ligado ? 'T' : 'F');
}

/**
 * acesso.alterarFlagsUsuario: as colunas que mudam, cada uma com a letra que a ficha mostrou (`antes`: T, F, vazio
 * ou nulo). A linha que mudou por fora (outra letra) recusa a gravação inteira (colisão).
 */
export const esquemaAlterarFlagsUsuario = z
  .object({
    login: esquemaLogin,
    flags: z
      .array(
        z
          .object({
            coluna: z.string().regex(/^[A-Z][A-Z0-9_]{0,62}$/),
            ligado: z.boolean(),
            antes: z.enum(['T', 'F', '']).nullable(),
          })
          .strict(),
      )
      .min(1, 'Escolha ao menos uma permissão para alterar.')
      .max(Object.keys(LETRAS_FLAGS_USUCPL).length)
      .refine((l) => new Set(l.map((f) => f.coluna)).size === l.length, 'Permissão repetida no pedido.'),
  })
  .strict();
export type AlterarFlagsUsuarioEntrada = z.infer<typeof esquemaAlterarFlagsUsuario>;
