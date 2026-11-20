// Decoradores da autorização (ficha do M06, regra 11; convencoes.md §12): `@Permissao('<codigo>')` em todo
// handler; `@Publica('<motivo>')` é a exceção explícita e comentada (ADR 0007); `@Auditar('<evento>')` grava o
// evento nas trilhas antes de a resposta sair ("sem trilha, sem dado"). `pnpm permissoes:verificar` recusa
// handler sem um dos dois primeiros.
import { SetMetadata } from '@nestjs/common';

export const CHAVE_PERMISSAO = 'sgh:permissao';
export const CHAVE_PUBLICA = 'sgh:publica';
export const CHAVE_AUDITAR = 'sgh:auditar';

/** A rota exige sessão e a permissão (CASL, as mesmas regras da tela). */
export const Permissao = (codigo: string) => SetMetadata(CHAVE_PERMISSAO, codigo);
export const CHAVE_PERMISSAO_OU = 'sgh:permissao-ou';
/**
 * Junto do `@Permissao`: as permissões que também abrem a rota (basta uma). Para o ato de dois papéis com permissões
 * distintas (revisão W0-03: a contenção mecânica, do enfermeiro que lê a linha do turno OU do prescritor). A
 * `@Permissao` segue sendo a declarada (chave de tela, `permissoes:verificar`); a que valeu vai em `req.sgh.permissao`.
 */
export const PermissaoOu = (...codigos: string[]) => SetMetadata(CHAVE_PERMISSAO_OU, codigos);
/** A guarda não confere sessão nem permissão (o handler confere o que precisar). Diga por quê. */
export const Publica = (motivo: string) => SetMetadata(CHAVE_PUBLICA, motivo);
/** Grava o evento do catálogo de auditoria (SGH_TRILHA e, quando o Delphi registra, a trilha do legado). */
export const Auditar = (evento: string) => SetMetadata(CHAVE_AUDITAR, evento);
export const CHAVE_AUDITADO_NO_HANDLER = 'sgh:auditado-no-handler';
/**
 * A ação que muda estado registra a trilha na própria transação (executor ou gravação SGH_), ou não muda
 * estado (bloqueada). Diga por quê: `pnpm permissoes:verificar` exige este ou o @Auditar em toda ação.
 */
export const AuditadoNoHandler = (motivo: string) => SetMetadata(CHAVE_AUDITADO_NO_HANDLER, motivo);
