// pnpm pep:conferencia -- --hospital=<código|todos> [--amostra=200] [--desde=2020] [--modelos=EVAM,ENF091]
// pnpm pep:conferencia -- --hospital=<código> --modelos=… --marco=M22   (relatório na pasta do marco, docs/marcos/M22)
// pnpm pep:conferencia -- --hospital=<código> --regerar   (refaz o .json e o .md do relatório já gravado, sem banco)
// Conferência cruzada do prontuário ao vivo (ficha do M15, regra 6; cap-11 §11.1): numa amostra estratificada
// (até N registros por modelo e ano), o registro lido das respostas estruturadas e montado pelo leitor é
// comparado com o formulário gravado com o registro, campo a campo (título e valor). Meta: 99,5% ou mais de
// igualdade. Roda sobre a cópia real em dev (DP-41): as amostras ficam no banco; só as TAXAS saem (relatório
// por modelo em docs/marcos/M15/conferencia-<hospital>.json e .md, com as contagens de 1 a 4 como "<5"), nunca
// conteúdo. Só leitura, transações curtas. Saída 1 se a meta não for alcançada (o relatório sai assim mesmo).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  conferirRegistro,
  converterModelo,
  definicaoParaLeitura,
  lerLayoutEpoca,
  lerRespostas,
  META_CONFERENCIA,
  type RepresentacaoFormulario,
  type ResultadoConferencia,
  somarConferencias,
  taxaIgualdade,
  TIPOS_FORA_DO_ESTRUTURADO,
} from '@sgh/dominio-pep';
import {
  amostraDoEstrato,
  estratosConferencia,
  lerConteudoRegistro,
  lerDefinicaoFormulario,
  lerRespostasRegistro,
  listarModelosFormulario,
} from '@sgh/legado';
import { criarNucleo, opcoesDe, raiz } from './nucleo.ts';
import { publicarConferencia, regerarConferencia, type ResumoConferencia } from './relatorio-conferencia.ts';

const opcoes = opcoesDe(process.argv.slice(2));
const amostra = Math.max(1, Math.min(1_000, Number(opcoes['amostra'] ?? 200) || 200));
const desde = Math.max(2000, Math.min(2100, Number(opcoes['desde'] ?? 2020) || 2020));
const marco = opcoes['marco'] ?? 'M15';
if (!/^M\d{2}$/.test(marco)) throw new Error('Use --marco=Mnn (pasta docs/marcos/Mnn).');
const soModelos = new Set(
  (opcoes['modelos'] ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean),
);

interface PorModelo {
  codigo: string;
  registros: number;
  ilegiveis: number;
  r: ResultadoConferencia[];
}

async function conferirHospital(cod: string): Promise<{ porModelo: Map<number, PorModelo>; ms: number }> {
  const { nucleo } = criarNucleo();
  const inicio = performance.now();
  try {
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'pep-conferencia' };
    const ler = <T>(fn: Parameters<typeof nucleo.lerSomente<T>>[1]) => nucleo.lerSomente(ctx, fn);
    const modelos = new Map((await ler((l) => listarModelosFormulario(l))).map((m) => [m.id, m]));
    const estratos = (await ler((l) => estratosConferencia(l, desde))).filter(
      (e) => soModelos.size === 0 || soModelos.has((e.codigo ?? '').toUpperCase()),
    );
    const porModelo = new Map<number, PorModelo>();
    const definicoes = new Map<
      number,
      {
        rep: RepresentacaoFormulario;
        leitura: ReturnType<typeof definicaoParaLeitura>;
        ignorar: Set<string>;
      } | null
    >();
    for (const e of estratos) {
      const m = modelos.get(e.modelo);
      if (!definicoes.has(e.modelo)) {
        const def = m ? await ler((l) => lerDefinicaoFormulario(l, m)) : null;
        const ignorar = new Set(
          (def?.perguntas ?? [])
            .filter((p) => TIPOS_FORA_DO_ESTRUTURADO.has((p.tipo ?? '').trim()))
            .map((p) => p.descricao ?? ''),
        );
        definicoes.set(
          e.modelo,
          def ? { rep: await converterModelo(def), leitura: definicaoParaLeitura(def), ignorar } : null,
        );
      }
      const d = definicoes.get(e.modelo) ?? null;
      const alvo = porModelo.get(e.modelo) ?? {
        codigo: e.codigo ?? `modelo-${e.modelo}`,
        registros: 0,
        ilegiveis: 0,
        r: [],
      };
      porModelo.set(e.modelo, alvo);
      const ids = await ler((l) => amostraDoEstrato(l, e, amostra));
      for (const id of ids) {
        const [conteudo, linhas] = await ler(
          async (l) =>
            [
              await lerConteudoRegistro(l, id, { rtf: false, xml: true }),
              await lerRespostasRegistro(l, id),
            ] as const,
        );
        alvo.registros++;
        if (!conteudo?.xml) continue;
        try {
          const campos = lerLayoutEpoca(conteudo.xml).campos;
          const respostas = lerRespostas({
            linhas,
            vinculos: d?.leitura.vinculos ?? [],
            respostas: d?.leitura.respostas ?? new Map(),
            representacao: d?.rep ?? null,
          });
          alvo.r.push(conferirRegistro(campos, respostas.itens, { ignorarTitulos: d?.ignorar ?? new Set() }));
        } catch {
          alvo.ilegiveis++;
        }
      }
    }
    return { porModelo, ms: performance.now() - inicio };
  } finally {
    await nucleo.encerrar();
  }
}

async function principal(): Promise<number> {
  if (process.argv.includes('--regerar')) {
    const cod = opcoes['hospital'] ?? '';
    if (!/^[a-z0-9]{1,8}$/.test(cod)) throw new Error('Use --hospital=<código> com --regerar.');
    const r = regerarConferencia(resolve(raiz, 'docs/marcos', marco), cod);
    console.log(`[${cod}] relatório refeito (igualdade ${(r.taxa * 100).toFixed(2)}%).`);
    return 0;
  }
  const { nucleo, codigos } = criarNucleo();
  await nucleo.encerrar();
  const pedido = opcoes['hospital'] ?? 'todos';
  const alvos = pedido === 'todos' ? codigos : codigos.filter((c) => c === pedido);
  if (alvos.length === 0) throw new Error(`Estabelecimento "${pedido}" não está em ESTABELECIMENTOS.`);
  if (pedido === 'todos' && alvos.length < 2)
    console.log(`Bloqueio: só ${alvos.join(', ')} configurado; os demais aguardam a cópia (HS-1).`);
  let ok = true;
  const pasta = resolve(raiz, 'docs/marcos', marco);
  mkdirSync(pasta, { recursive: true });
  for (const cod of alvos) {
    const { porModelo, ms } = await conferirHospital(cod);
    const modelos = [...porModelo.entries()]
      .map(([id, m]) => {
        const s = somarConferencias(m.r);
        return {
          modelo: id,
          codigo: m.codigo,
          registros: m.registros,
          ilegiveis: m.ilegiveis,
          comparados: s.comparados,
          iguais: s.iguais,
          valorDiferente: s.valorDiferente,
          semPar: s.semPar,
          foraDoEstruturado: s.ignorados ?? 0,
          taxa: Number(taxaIgualdade(s).toFixed(4)),
        };
      })
      .sort((a, b) => b.comparados - a.comparados);
    const total = somarConferencias([...porModelo.values()].flatMap((m) => m.r));
    const taxa = taxaIgualdade(total);
    if (taxa < META_CONFERENCIA) ok = false;
    const data = new Date().toISOString().slice(0, 10);
    const resumo: ResumoConferencia = {
      formato: 1,
      estabelecimento: cod,
      data,
      amostraPorEstrato: amostra,
      desde,
      registros: modelos.reduce((a, m) => a + m.registros, 0),
      comparados: total.comparados,
      iguais: total.iguais,
      valorDiferente: total.valorDiferente,
      semPar: total.semPar,
      foraDoEstruturado: total.ignorados ?? 0,
      taxa: Number(taxa.toFixed(4)),
      meta: META_CONFERENCIA,
      minutos: Number((ms / 60_000).toFixed(1)),
      modelos,
    };
    publicarConferencia(pasta, resumo);
    console.log(
      `[${cod}] ${resumo.registros} registros; ${total.comparados} campos; igualdade ${(taxa * 100).toFixed(2)}% (meta ${(META_CONFERENCIA * 100).toFixed(1)}%); ${resumo.minutos} min.`,
    );
  }
  return ok ? 0 : 1;
}

principal().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error(`Falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
