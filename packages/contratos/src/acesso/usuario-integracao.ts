// Entrada de `acesso.criarUsuarioIntegracao` (ficha do M04, item 5): o usuário técnico do sistema novo em
// TBUSERS (sem grupo, bloqueado, sem senha, sem poder de login). O nome é a chave de auditoria do legado
// (TBUSERS.NOME, VARCHAR(31), comparação exata e sensível a maiúsculas; ref 01 §4.3).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const esquemaCriarUsuarioIntegracao = z
  .object({
    /** Login técnico: sem espaço, até 31 caracteres; o nome real é decidido pelo responsável técnico. */
    nome: textoCp1252(31).pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9._-]{3,31}$/, 'Use de 3 a 31 letras, dígitos, ponto, hífen ou sublinhado.'),
    ),
    /** Nome completo (TBUSERS.NOMEC); vazio aceito quando o perfil mostrar que o legado aceita. */
    nomeCompleto: textoCp1252(70).overwrite((t) => t.trim()),
  })
  .strict();

export type CriarUsuarioIntegracaoEntrada = z.infer<typeof esquemaCriarUsuarioIntegracao>;
