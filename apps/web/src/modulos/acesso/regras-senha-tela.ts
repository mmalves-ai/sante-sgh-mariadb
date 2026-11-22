// Regras da política de senha vigente (GET /api/sessao/senha/politica) e a conferência ao vivo na tela "Trocar a
// senha". A tela confere só as regras marcadas `aoVivo` (tamanho, classes, login, igual à atual); as demais (nome,
// nascimento, lista de comuns, histórico) o servidor confere na troca. A recusa do servidor é sempre a palavra final.
import { FALHAS_SENHA } from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export const esquemaRegrasSenha = z.object({
  login: z.string(),
  regras: z.array(
    z.object({
      codigo: z.enum(FALHAS_SENHA),
      valor: z.number().int().optional(),
      aoVivo: z.boolean(),
      mensagem: z.string(),
    }),
  ),
});
export type RegrasSenha = z.infer<typeof esquemaRegrasSenha>;
export type RegraSenha = RegrasSenha['regras'][number];
export type EstadoRegra = 'ok' | 'pendente' | 'na-troca';

export async function buscarRegrasSenha(buscar: typeof fetch = fetch): Promise<RegrasSenha> {
  const r = await buscar('/api/sessao/senha/politica');
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaRegrasSenha.parse(await r.json());
}

/** Só letras e dígitos, sem acento e em minúsculas (a mesma redução do servidor). */
function reduzir(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function derivaDoLogin(senha: string, login: string): boolean {
  const s = reduzir(senha);
  const l = reduzir(login);
  if (l.length < 3 || s.length === 0) return false;
  return s.includes(l) || s.includes([...l].reverse().join('')) || l.includes(s);
}

/** Estado de uma regra para a senha digitada: ok, pendente, ou conferida só na troca (servidor). */
export function estadoRegra(regra: RegraSenha, senha: string, login: string, atual: string): EstadoRegra {
  if (!regra.aoVivo) return 'na-troca';
  if (senha === '') return 'pendente';
  const cumpre = ((): boolean => {
    switch (regra.codigo) {
      case 'curta':
        return [...senha].length >= (regra.valor ?? 0);
      case 'sem-letra':
        return /\p{L}/u.test(senha);
      case 'sem-numero':
        return /\p{Nd}/u.test(senha);
      case 'sem-especial':
        return /[^\p{L}\p{Nd}\s]/u.test(senha);
      case 'sem-minuscula':
        return /\p{Ll}/u.test(senha);
      case 'sem-maiuscula':
        return /\p{Lu}/u.test(senha);
      case 'deriva-do-login':
        return !derivaDoLogin(senha, login);
      case 'igual-atual':
        return atual === '' || senha !== atual;
      default:
        return true;
    }
  })();
  return cumpre ? 'ok' : 'pendente';
}
