// M60, etapa 2: o modelo comentado do arquivo de ambiente do servidor e a conferência do arquivo preenchido (regra 6:
// segredos só no servidor, arquivo 0600). As mensagens citam só NOMES de chave, nunca valores.
import { parseEnv } from 'node:util';
import {
  CAMPOS_ESTABELECIMENTO,
  GRUPOS,
  MARCADOR_PREENCHER,
  MARCADOR_SEGREDO,
  NAO_CONFIGURAVEIS,
  VARIAVEIS,
  type Variavel,
} from './variaveis.ts';
import { LAYOUT } from './artefatos.ts';

const linhaComentario = (t: string) => `# ${t}`;

function blocoVariavel(x: Variavel): string[] {
  const nota = [
    x.uso === 'obrigatoria' ? 'OBRIGATÓRIA' : x.uso === 'recomendada' ? 'recomendada' : 'opcional',
    x.segredo ? 'SEGREDO' : null,
    x.valores ? `valores: ${x.valores.filter((y) => y !== '').join(', ')}` : null,
    x.comoGerar ? `gere com: ${x.comoGerar}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  const atribuicao = `${x.chave}=${x.exemplo}`;
  return [
    linhaComentario(`${x.descricao} (${nota})`),
    x.uso === 'opcional' && x.exemplo === '' ? `# ${atribuicao}` : atribuicao,
  ];
}

/** O modelo comentado (`deploy/ubuntu/sante.env.modelo`), com a série do estabelecimento de exemplo `pc`. */
export function modeloAmbiente(codigoExemplo = 'pc'): string {
  const C = codigoExemplo.toUpperCase();
  const saida: string[] = [
    '# Arquivo de ambiente do servidor de aplicação: /etc/sante-sgh/sante.env (0600, dono o usuário do serviço).',
    '# Gerado por pnpm instalacao:gerar (tools/instalacao); não edite o modelo à mão.',
    `# Troque todo ${MARCADOR_PREENCHER} e todo ${MARCADOR_SEGREDO}; a conferência recusa o arquivo que ainda os tenha.`,
    '# Nenhum segredo vai para o repositório: este modelo só tem marcadores.',
    '',
  ];
  for (const g of GRUPOS) {
    const doGrupo = VARIAVEIS.filter((x) => x.grupo === g.grupo);
    if (doGrupo.length === 0) continue;
    saida.push(`# ── ${g.titulo} ${'─'.repeat(Math.max(0, 100 - g.titulo.length))}`, '');
    for (const x of doGrupo) saida.push(...blocoVariavel(x), '');
    if (g.grupo === 'banco') {
      saida.push(
        `# Série por estabelecimento: FB_<CÓDIGO>_<CAMPO>, uma para cada código de ESTABELECIMENTOS (exemplo: ${codigoExemplo}).`,
        '# Três contas, todas com autenticação Srp: aplicação (papel SGH_APLICACAO), scripts (dona dos objetos SGH_) e leitura.',
        '',
      );
      for (const c of CAMPOS_ESTABELECIMENTO)
        saida.push(
          linhaComentario(
            `${c.descricao} (${c.uso === 'obrigatoria' ? 'OBRIGATÓRIA' : c.uso}${c.segredo ? '; SEGREDO' : ''})`,
          ),
          `FB_${C}_${c.campo}=${c.exemplo}`,
          '',
        );
    }
  }
  return saida.join('\n');
}

export interface ProblemaAmbiente {
  readonly chave: string;
  readonly motivo: string;
}

const AMBIENTES_SERVIDOR = new Set(['producao', 'homolog', 'treino']);

/**
 * Confere o arquivo preenchido (texto). Problemas: obrigatória ausente ou com marcador, valor fora da lista, chave
 * de dev/teste presente, conta SYSDBA, contas iguais, chave mestra fora do formato, porta inválida.
 */
export function conferirAmbiente(texto: string): ProblemaAmbiente[] {
  const env = parseEnv(texto) as Record<string, string>;
  const p: ProblemaAmbiente[] = [];
  const val = (k: string) => (env[k] ?? '').trim();
  const temMarcador = (s: string) => s.includes(MARCADOR_PREENCHER) || s.includes(MARCADOR_SEGREDO);

  const ambiente = val('AMBIENTE');
  if (!AMBIENTES_SERVIDOR.has(ambiente))
    p.push({
      chave: 'AMBIENTE',
      motivo: 'use producao, homolog ou treino (dev e ci não rodam no servidor).',
    });

  for (const x of VARIAVEIS) {
    const v = val(x.chave);
    if (x.uso === 'obrigatoria' && v === '') p.push({ chave: x.chave, motivo: 'obrigatória e ausente.' });
    else if (temMarcador(v)) p.push({ chave: x.chave, motivo: 'ainda com o marcador do modelo.' });
    else if (v !== '' && x.valores && !x.valores.includes(v))
      p.push({ chave: x.chave, motivo: `valor fora da lista (${x.valores.filter((y) => y).join(', ')}).` });
  }

  for (const k of Object.keys(env))
    if (k in NAO_CONFIGURAVEIS && !['ORIGEM', 'DESTINO', 'ENVIADA_POR'].includes(k))
      p.push({ chave: k, motivo: `não vai ao servidor (${NAO_CONFIGURAVEIS[k]}).` });

  const mestra = val('PLATAFORMA_CHAVE_MESTRA');
  if (mestra !== '' && !temMarcador(mestra) && Buffer.from(mestra, 'base64').length !== 32)
    p.push({ chave: 'PLATAFORMA_CHAVE_MESTRA', motivo: '32 bytes em base64 (openssl rand -base64 32).' });
  const marca = val('MARCA');
  if (marca !== '' && !temMarcador(marca) && !/^[a-z0-9-]+$/.test(marca))
    p.push({
      chave: 'MARCA',
      motivo: 'código do pacote de marca: letras minúsculas, dígitos e hífen (ex.: rede-sante).',
    });
  const sonda = val('SONDA_TOKEN');
  if (sonda !== '' && !temMarcador(sonda) && sonda.length < 32)
    p.push({ chave: 'SONDA_TOKEN', motivo: 'no mínimo 32 caracteres.' });

  const codigos = val('ESTABELECIMENTOS')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  for (const cod of codigos) {
    const C = cod.toUpperCase();
    for (const c of CAMPOS_ESTABELECIMENTO) {
      const k = `FB_${C}_${c.campo}`;
      const v = val(k);
      // A senha da conta de scripts pode ficar fora do arquivo (informada só na hora da migração).
      if (v === '' && c.uso === 'obrigatoria' && c.campo !== 'SCRIPTS_SENHA')
        p.push({ chave: k, motivo: 'obrigatória e ausente.' });
      else if (temMarcador(v)) p.push({ chave: k, motivo: 'ainda com o marcador do modelo.' });
    }
    const porta = Number(val(`FB_${C}_PORTA`));
    if (val(`FB_${C}_PORTA`) !== '' && (!Number.isInteger(porta) || porta < 1 || porta > 65535))
      p.push({ chave: `FB_${C}_PORTA`, motivo: 'porta inválida.' });
    const contas = ['USUARIO', 'SCRIPTS_USUARIO', 'LEITURA_USUARIO'].map((c) => ({
      chave: `FB_${C}_${c}`,
      valor: val(`FB_${C}_${c}`).toUpperCase(),
    }));
    for (const c of contas)
      if (c.valor === 'SYSDBA') p.push({ chave: c.chave, motivo: 'SYSDBA é recusado: use a conta própria.' });
    const vistas = contas.filter((c) => c.valor !== '' && !temMarcador(c.valor)).map((c) => c.valor);
    if (new Set(vistas).size !== vistas.length)
      p.push({
        chave: `FB_${C}_USUARIO`,
        motivo: 'as contas de aplicação, scripts e leitura têm de ser diferentes.',
      });
  }
  if (codigos.length === 0 && !p.some((x) => x.chave === 'ESTABELECIMENTOS'))
    p.push({ chave: 'ESTABELECIMENTOS', motivo: 'nenhum estabelecimento.' });

  const lib = val('FB_CLIENTE_BIBLIOTECA');
  if (lib !== '' && !lib.startsWith('/'))
    p.push({ chave: 'FB_CLIENTE_BIBLIOTECA', motivo: 'caminho absoluto.' });
  // A porta da API é fixada pelo pacote: o site do nginx e a espera da saúde usam a do layout (achado da revisão).
  const portaApi = val('API_PORTA');
  if (portaApi !== '' && portaApi !== String(LAYOUT.portaApi))
    p.push({
      chave: 'API_PORTA',
      motivo: `a porta é fixada pelo pacote: deixe vazia ou ${LAYOUT.portaApi}.`,
    });
  for (const k of ['WEB_ENDERECO', 'DOCUMENTO_URL_VALIDACAO']) {
    const v = val(k);
    if (v !== '' && !temMarcador(v) && !v.startsWith('https://'))
      p.push({ chave: k, motivo: 'endereço https.' });
  }
  return p;
}
