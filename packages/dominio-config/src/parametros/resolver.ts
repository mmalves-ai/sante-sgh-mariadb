// Regra 8 do M08 (cap-09 §9.5): parâmetro NOVO vale o nível mais específico VIGENTE — usuário, perfil,
// unidade, estabelecimento, empresa, rede e o padrão do registro; nível não permitido pela definição é
// ignorado na leitura e recusado na gravação (422); "explicar valor" diz de onde veio o valor e o que foi
// sobreposto. Dois perfis da pessoa com valores diferentes são conflito: a leitura não escolhe (segue para o
// nível seguinte e mostra o conflito) e a gravação recusa (vigencia.ts).
import {
  type DefinicaoParametro,
  type Explicacao,
  NIVEIS_PARAMETRO,
  type NivelParametro,
  type ValorParametro,
} from '@sgh/contratos';

/** Para quem se resolve: os alvos de cada nível (perfis: todos os da pessoa). */
export interface SujeitoParametro {
  readonly rede: string;
  readonly empresa: string | null;
  readonly estabelecimento: string;
  readonly unidade: string | null;
  readonly perfis: readonly string[];
  readonly usuario: string;
}

export function vigenteEm(v: Pick<ValorParametro, 'vigenteDesde' | 'vigenteAte'>, agora: Date): boolean {
  const t = agora.getTime();
  return (
    new Date(v.vigenteDesde).getTime() <= t && (v.vigenteAte === null || new Date(v.vigenteAte).getTime() > t)
  );
}

function alvosDoNivel(n: NivelParametro, s: SujeitoParametro): readonly string[] {
  switch (n) {
    case 'usuario':
      return [s.usuario];
    case 'perfil':
      return s.perfis;
    case 'unidade':
      return s.unidade === null ? [] : [s.unidade];
    case 'estabelecimento':
      return [s.estabelecimento];
    case 'empresa':
      return s.empresa === null ? [] : [s.empresa];
    case 'rede':
      return [s.rede];
  }
}

export function resolverParametro(
  def: DefinicaoParametro,
  valores: readonly ValorParametro[],
  sujeito: SujeitoParametro,
  agora: Date,
): Explicacao {
  const passos: Explicacao['passos'] = [];
  let vencedor: ValorParametro | null = null;
  for (const nivel of NIVEIS_PARAMETRO) {
    const alvos = alvosDoNivel(nivel, sujeito);
    const doNivel = valores.filter(
      (v) => v.chave === def.chave && v.nivel === nivel && alvos.includes(v.alvo) && vigenteEm(v, agora),
    );
    if (doNivel.length === 0) {
      passos.push({ nivel, alvo: alvos[0] ?? null, valor: null, situacao: 'sem-valor' });
      continue;
    }
    if (!def.niveis.includes(nivel)) {
      for (const v of doNivel)
        passos.push({ nivel, alvo: v.alvo, valor: v.valor, situacao: 'nao-permitido' });
      continue;
    }
    const distintos = new Set(doNivel.map((v) => v.valor));
    if (distintos.size > 1) {
      for (const v of doNivel) passos.push({ nivel, alvo: v.alvo, valor: v.valor, situacao: 'conflito' });
      continue;
    }
    // Mesmo valor em todos os alvos do nível (ex.: dois perfis concordam): vale o primeiro vigente.
    const [primeiro] = [...doNivel].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
    if (vencedor === null) {
      vencedor = primeiro ?? null;
      passos.push({ nivel, alvo: primeiro?.alvo ?? null, valor: primeiro?.valor ?? null, situacao: 'vale' });
    } else {
      passos.push({
        nivel,
        alvo: primeiro?.alvo ?? null,
        valor: primeiro?.valor ?? null,
        situacao: 'sobreposto',
      });
    }
  }
  passos.push({ nivel: 'padrao', alvo: null, valor: def.padrao, situacao: vencedor ? 'sobreposto' : 'vale' });
  return {
    chave: def.chave,
    valor: vencedor?.valor ?? def.padrao,
    origem: vencedor?.nivel ?? 'padrao',
    alvo: vencedor?.alvo ?? null,
    passos,
    vigenteDesde: vencedor?.vigenteDesde ?? null,
    autor: vencedor?.autor ?? null,
    justificativa: vencedor?.justificativa ?? null,
  };
}

/** Valor convertido ao tipo da definição (a tela e os consumidores leem por aqui). */
export function valorTipado(def: DefinicaoParametro, valor: string): number | boolean | string {
  if (def.tipo === 'inteiro') return Number.parseInt(valor, 10);
  if (def.tipo === 'booleano') return valor === 'sim';
  return valor;
}
