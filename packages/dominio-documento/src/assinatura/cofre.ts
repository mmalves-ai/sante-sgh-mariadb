// Segredos dos provedores no cofre (M49; ICP-06; cap-08 §8.11): o client secret do PSC e o certificado A1 do serviço
// ficam no cofre, nunca em tabela, log, tela ou repositório. A tabela guarda só a REFERÊNCIA (`cofre:psc/<estab>/<codigo>/...`)
// e a tela mostra "definido" ou "não definido". Aqui: montar e ler a referência, a situação para a tela e a guarda que
// recusa gravar um objeto de configuração com cara de segredo em claro.

export const TIPOS_SEGREDO = ['client-secret', 'certificado-servico', 'senha-certificado-servico'] as const;
export type TipoSegredo = (typeof TIPOS_SEGREDO)[number];

/**
 * `cofre:psc/<estabelecimento>/<codigo>/<tipo>`: o provedor é do estabelecimento (SGH_DOC_PROVEDOR_PSC tem UNIQUE
 * (HOSPITAL, CODIGO)), e o segredo também. Sem o estabelecimento na referência, um estabelecimento cadastraria o mesmo
 * código de outro e usaria (ou trocaria) o segredo dele.
 */
const REF =
  /^cofre:psc\/([a-z0-9][a-z0-9_-]{0,9})\/([a-z][a-z0-9-]{1,29})\/(client-secret|certificado-servico|senha-certificado-servico)$/;

export function referenciaCofre(hospital: string, provedor: string, tipo: TipoSegredo): string {
  const r = `cofre:psc/${hospital}/${provedor}/${tipo}`;
  if (!REF.test(r)) throw new Error('Estabelecimento ou código de provedor inválido para o cofre.');
  return r;
}

export function lerReferenciaCofre(
  r: string,
): { hospital: string; provedor: string; tipo: TipoSegredo } | null {
  const m = REF.exec(r);
  return m ? { hospital: m[1]!, provedor: m[2]!, tipo: m[3] as TipoSegredo } : null;
}

/** O que a tela de provedores mostra do segredo. */
export const situacaoSegredo = (existeNoCofre: boolean): 'definido' | 'nao-definido' =>
  existeNoCofre ? 'definido' : 'nao-definido';

const CHAVE_SENSIVEL = /(secret|segredo|senha|password|token|chave|private|privada|pfx|p12)/i;

/**
 * Guarda antes de gravar configuração em tabela `SGH_`: campo de nome sensível só pode conter referência ao cofre (ou
 * vazio). Devolve os caminhos dos campos recusados (nunca o valor).
 */
export function camposComSegredoEmClaro(obj: unknown, caminho = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const r: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const aqui = caminho ? `${caminho}.${k}` : k;
    if (typeof v === 'object' && v !== null) r.push(...camposComSegredoEmClaro(v, aqui));
    else if (CHAVE_SENSIVEL.test(k) && typeof v === 'string' && v !== '' && !lerReferenciaCofre(v))
      r.push(aqui);
  }
  return r;
}

/** CPF para a tela: só os 6 dígitos do meio (***.456.789-**), como o padrão de mascaramento do projeto. */
export function mascararCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '').padStart(11, '0');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
