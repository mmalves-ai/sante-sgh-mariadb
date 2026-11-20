// Documentos da consolidação (ficha do M35, regras 5, 6 e 7): o relatório de prontidão em Markdown (os
// estabelecimentos separados), o pacote de homologação por setor e o material de treinamento por tarefa (guia de
// uma página e roteiro de vídeo), gerados das jornadas automáticas na versão atual da tela. Regras puras: quem lê
// os arquivos e grava é o script (tools/verificadores). O material visto pelo usuário nunca cita o outro sistema
// pelo nome (ADR 0023).
import type {
  DefinicaoSetor,
  HospitalProntidao,
  RelatorioProntidao,
  SetorProntidao,
  TarefaTreinamento,
} from '@sgh/contratos';
import { contagemSegura } from './prontidao.js';

const ROTULO_VEREDITO: Readonly<Record<SetorProntidao['veredito'], string>> = {
  'pronto-para-homologar': 'pronto para homologar',
  'pronto-com-ressalvas': 'pronto para homologar, com ressalvas',
  'nao-construido': 'em construção (Fase 4)',
  bloqueado: 'bloqueado (sem a cópia)',
};

const ROTULO_ITEM: Readonly<Record<SetorProntidao['itens'][number]['item'], string>> = {
  construcao: 'Construção',
  operacoes: 'Operações do setor',
  aceite: 'Aceite do chave-usuário',
  treinamento: 'Treinamento do papel',
  estacoes: 'Estações e impressoras',
  carga: 'Carga do banco',
  apoio: 'Apoio no setor',
  pentest: 'Pentest externo',
};

const ROTULO_SITUACAO: Readonly<Record<SetorProntidao['itens'][number]['situacao'], string>> = {
  atendido: 'atendido',
  'com-ressalva': 'com ressalva',
  'nao-atendido': 'não atendido',
  fase4: 'Fase 4',
  bloqueado: 'bloqueado',
};

const celula = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function secaoHospital(h: HospitalProntidao): string[] {
  const linhas: string[] = [`## ${h.nome} (\`${h.codigo}\`)`, ''];
  if (h.bloqueio) linhas.push(`**Bloqueio:** ${h.bloqueio}`, '');
  linhas.push(
    '### Proposta para o comitê de coexistência',
    '',
    `- Onda 0 (só leitura): ${h.proposta.onda0.length ? h.proposta.onda0.map((s) => `\`${s}\``).join(', ') : 'nenhum setor'}`,
    `- Onda 1: ${h.proposta.onda1.length ? h.proposta.onda1.map((s) => `\`${s}\``).join(', ') : 'nenhum setor'}`,
    ...h.proposta.foraDaProposta.map((f) => `- Fora da proposta: \`${f.setor}\` — ${f.motivo}`),
    `- Chaves de liberação preparadas (todas desligadas): ${h.chavesPreparadas ?? '—'}; ligadas: ${h.chavesLigadas ?? '—'}`,
    '',
    '### Setores',
    '',
    '| Onda | Setor | Veredito | Operações verdes | Construção | Carga | Treinamento |',
    '|---|---|---|---|---|---|---|',
  );
  const sit = (s: SetorProntidao, i: string) => {
    const x = s.itens.find((y) => y.item === i);
    return x ? ROTULO_SITUACAO[x.situacao] : '—';
  };
  for (const s of h.setores)
    linhas.push(
      `| ${s.onda} | ${celula(s.nome)} (\`${s.id}\`) | ${ROTULO_VEREDITO[s.veredito]} | ${s.operacoes.verdes}/${s.operacoes.total} | ${sit(s, 'construcao')} | ${sit(s, 'carga')} | ${sit(s, 'treinamento')} |`,
    );
  linhas.push('');
  for (const s of h.setores) {
    linhas.push(`#### ${s.nome} (onda ${s.onda}): ${ROTULO_VEREDITO[s.veredito]}`, '');
    for (const i of s.itens)
      linhas.push(`- ${ROTULO_ITEM[i.item]}: **${ROTULO_SITUACAO[i.situacao]}** — ${i.detalhe}`);
    if (s.operacoes.fora.length && !h.bloqueio) {
      linhas.push('', '| Operação fora de `verde` | Estado | Motivo |', '|---|---|---|');
      for (const f of s.operacoes.fora) linhas.push(`| \`${f.nome}\` | ${f.estado} | ${celula(f.motivo)} |`);
    }
    if (s.ordemFase4.length) linhas.push('', `Ordem de construção na Fase 4: ${s.ordemFase4.join(' → ')}.`);
    if (s.duvidas.length) linhas.push('', `Dúvidas abertas: ${s.duvidas.join('; ')}.`);
    linhas.push('');
  }
  linhas.push(
    '### Público por papel (usuários ativos e não bloqueados)',
    '',
    '| Papel | Usuários | Referência (cap-15 §15.4.1) | Parcelas | Ondas | Guias |',
    '|---|---|---|---|---|---|',
  );
  for (const p of h.publico)
    linhas.push(
      `| ${p.nome} | ${p.menorQue5 ? '<5' : contagemSegura(p.usuarios)} | ${p.referencia} | ${p.parcelas
        .filter((x) => x.usuarios !== null || x.menorQue5 || x.referencia !== null)
        .map((x) => `${x.grupo} ${x.menorQue5 ? '<5' : contagemSegura(x.usuarios)}`)
        .join(' + ')} | ${p.ondas.join(', ')} | ${p.guias} |`,
    );
  linhas.push('', `Total medido: ${h.publicoTotal ?? '— (sem medida)'}.`, '');
  return linhas;
}

/** O relatório de prontidão em Markdown: o ProntoCardio e o Serrano separados (regra 8). */
export function relatorioProntidaoMarkdown(r: RelatorioProntidao): string {
  const c = r.carga;
  return [
    '# Relatório de prontidão por setor e hospital',
    '',
    `Gerado por \`pnpm prontidao:relatorio\` em ${r.geradoEm.slice(0, 10)} (ficha do M35, regra 7; cap-15 §15.2.2, §15.3.2, §15.3.3). "Pronto para homologar" não é liberação: nenhuma chave está ligada (operações liberadas: ${r.liberadas}). O que não ficou pronto segue sem mudança até a construção na Fase 4 (cap-15 §15.5).`,
    '',
    `Estados do catálogo (operação × estabelecimento): \`${JSON.stringify(r.estados)}\`.`,
    '',
    '## Carga somada',
    '',
    ...(c
      ? [
          `\`${c.cenario}\`, ${c.usuarios} usuários, ${c.executadoEm.slice(0, 10)}: **${c.resultado}**${c.indicativo ? ' (indicativo: cópia de desenvolvimento, DP-15)' : ''}. Arquivo: \`${c.arquivo}\`.`,
          '',
          '| Jornada | p95 (ms) | Meta (ms) | Atendida |',
          '|---|---|---|---|',
          ...c.jornadas.map(
            (j) =>
              `| ${j.jornada} | ${j.p95Ms ?? '—'} | ${j.metaMs ?? '—'} | ${j.atendida === null ? '—' : j.atendida ? 'sim' : 'não'} |`,
          ),
          '',
          ...(c.metasNaoMedidas?.length
            ? [
                '**Parcial**: o cenário só exercita as rotas de leitura de carga (contagens). Metas do cap-14 §14.5 não medidas com a rota real (ficam para a homologação, M36):',
                '',
                '| Meta | Alvo | Por que não medida |',
                '|---|---|---|',
                ...c.metasNaoMedidas.map((m) => `| ${m.meta} | ${m.alvo} | ${m.motivo} |`),
                '',
              ]
            : []),
          `MON$: transação mais longa do novo ${c.mon.transacaoMaisLongaMs ?? '—'} ms; acima do limite ${c.mon.acimaDoLimite ?? '—'}; escritas ${c.mon.escritas ?? '—'}.`,
          '',
          ...(c.outroSistema.length
            ? [
                '| Operação-chave do outro sistema (simulada) | p95 antes (ms) | p95 durante (ms) |',
                '|---|---|---|',
                ...c.outroSistema.map(
                  (o) => `| ${o.operacao} | ${o.antesP95Ms ?? '—'} | ${o.duranteP95Ms ?? '—'} |`,
                ),
                '',
              ]
            : []),
        ]
      : ['Sem medição.', '']),
    ...r.hospitais.flatMap(secaoHospital),
  ].join('\n');
}

/** Teste do E2E com o título e o corpo (para os passos). */
export interface TesteJornada {
  readonly titulo: string;
  readonly corpo: string;
}

/** Os testes de um arquivo de E2E (`test('título', async (...) => { … })`), com o corpo até o próximo teste. */
export function testesDoArquivo(codigo: string): TesteJornada[] {
  const re = /\btest\(\s*(['`"])((?:\\.|(?!\1).)*)\1\s*,/g;
  const achados: { titulo: string; inicio: number }[] = [];
  for (let m = re.exec(codigo); m; m = re.exec(codigo))
    achados.push({
      titulo: (m[2] ?? '')
        .replace(/\$\{[^}]*\}/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      inicio: m.index,
    });
  return achados.map((a, i) => ({
    titulo: a.titulo,
    corpo: codigo.slice(a.inicio, achados[i + 1]?.inicio ?? codigo.length),
  }));
}

/** Testes cujo título contém o trecho (sem diferenciar maiúsculas); trecho vazio: todos. */
export function testesDaJornada(testes: readonly TesteJornada[], trecho: string): TesteJornada[] {
  const t = trecho.toLowerCase();
  return testes.filter((x) => !t || x.titulo.toLowerCase().includes(t));
}

/** Siglas que o identificador do campo traz em minúsculas. */
const SIGLAS = new Set(['cep', 'cpf', 'cns', 'crm', 'cid', 'rg', 'uf', 'tiss', 'sus']);

const nomeDoPadrao = (bruto: string) =>
  bruto
    .replace(/^\/(.*)\/[a-z]*$/s, '$1')
    .replace(/\\(.)/g, '$1')
    .replace(/[\^$]/g, '')
    .replace(/\.\*\??|\(\?:|\)|\[[^\]]*\]|\|.*$/g, '')
    .trim();

/**
 * Passos legíveis de um teste de E2E: a tela aberta (pelo rótulo do menu da rota), os botões, links e abas
 * acionados, os campos preenchidos e o que se confere. Valores digitados (dados sintéticos) nunca entram.
 */
export function passosDoTeste(corpo: string, rotuloDaRota: (rota: string) => string | null): string[] {
  const passos: string[] = [];
  const nome = String.raw`\{\s*name:\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|(\/(?:\\.|[^/])+\/[a-z]*))`;
  const re = new RegExp(
    [
      String.raw`page\.goto\(\s*['\`]([^'\`$?]+)`,
      String.raw`getByRole\(\s*'(button|link|tab|menuitem|checkbox|radio|option|combobox|textbox)'\s*,\s*${nome}[^)]*\)\s*\)?\s*\.(click|check|fill|selectOption|press)`,
      String.raw`getByLabel\(\s*(?:'((?:\\.|[^'])*)'|(\/(?:\\.|[^/])+\/[a-z]*))[^)]*\)\s*\.(fill|selectOption|check|click|press)`,
      String.raw`expect\([^;]*?getBy(?:Text|Role\(\s*'(?:heading|alert|status)'\s*,\s*\{\s*name:)\s*\(?\s*(?:'((?:\\.|[^'])*)'|(\/(?:\\.|[^/])+\/[a-z]*))`,
      String.raw`\.(?:toHaveText|toContainText)\(\s*'((?:\\.|[^'])*)'`,
      String.raw`getByTestId\(\s*'(?:campo|botao|aba|acao)-([a-z0-9-]+)'\s*\)\s*\.(click|fill|selectOption|check)`,
    ].join('|'),
    'g',
  );
  for (let m = re.exec(corpo); m; m = re.exec(corpo)) {
    let p: string | null = null;
    if (m[1]) {
      const rota = m[1].replace(/\/$/, '') || '/';
      const r = rotuloDaRota(rota);
      p = r ? `Abra **${r}**.` : null;
    } else if (m[2]) {
      const alvo = nomeDoPadrao(m[3] ?? m[4] ?? m[5] ?? '');
      if (!alvo) continue;
      const acao = m[6];
      p =
        m[2] === 'tab'
          ? `Vá à aba **${alvo}**.`
          : m[2] === 'link'
            ? `Abra **${alvo}**.`
            : m[2] === 'checkbox' || m[2] === 'radio' || acao === 'check'
              ? `Marque **${alvo}**.`
              : acao === 'fill' || m[2] === 'textbox'
                ? `Preencha **${alvo}**.`
                : acao === 'selectOption' || m[2] === 'combobox' || m[2] === 'option'
                  ? `Escolha em **${alvo}**.`
                  : `Clique em **${alvo}**.`;
    } else if (m[7] !== undefined || m[8] !== undefined) {
      const alvo = nomeDoPadrao(m[7] ?? m[8] ?? '');
      if (!alvo) continue;
      const acao = m[9];
      p =
        acao === 'fill'
          ? `Preencha **${alvo}**.`
          : acao === 'selectOption'
            ? `Escolha em **${alvo}**.`
            : acao === 'check'
              ? `Marque **${alvo}**.`
              : `Use o campo **${alvo}**.`;
    } else if (m[10] !== undefined || m[11] !== undefined || m[12] !== undefined) {
      const alvo = nomeDoPadrao(m[10] ?? m[11] ?? m[12] ?? '');
      // Só textos da tela: sem dígitos (horários, números e códigos da massa sintética ficam fora).
      // Nem os valores da massa (em maiúsculas, como o cadastro grava, ou marcados como sintéticos).
      if (
        !alvo ||
        alvo.length < 3 ||
        /\d/.test(alvo) ||
        /sint[eé]tic/i.test(alvo) ||
        alvo === alvo.toUpperCase()
      )
        continue;
      p = `Confira: aparece **${alvo}**.`;
    } else if (m[13] !== undefined) {
      // O identificador do campo ou do botão (`campo-cep`, `botao-procurar-cpf`), quando o teste não usa o rótulo.
      const alvo = m[13]
        .replace(/-\d+$/, '')
        .split('-')
        .map((w) => (SIGLAS.has(w) ? w.toUpperCase() : w))
        .join(' ');
      const acao = m[14];
      p =
        acao === 'fill'
          ? `Preencha **${alvo}**.`
          : acao === 'selectOption'
            ? `Escolha em **${alvo}**.`
            : acao === 'check'
              ? `Marque **${alvo}**.`
              : `Clique em **${alvo}**.`;
    }
    if (p && passos[passos.length - 1] !== p) passos.push(p);
  }
  return passos;
}

const ROTULO_PAPEL_ONDA = (t: TarefaTreinamento) => `papel ${t.papel}, onda ${t.onda}`;

/** Guia de uma página da tarefa (cap-15 §15.4.2). */
export function guiaMarkdown(
  t: TarefaTreinamento,
  passos: readonly string[],
  titulosDosTestes: readonly string[],
): string {
  return [
    `# ${t.titulo}`,
    '',
    `Guia de uma página (${ROTULO_PAPEL_ONDA(t)}). Gerado por \`pnpm treinamento:gerar\` da jornada automática \`${t.jornada.arquivo}\`${t.jornada.teste ? ` (“${t.jornada.teste}”)` : ''}, na versão atual da tela.`,
    '',
    '## Passo a passo',
    '',
    ...(passos.length ? passos.map((p, i) => `${i + 1}. ${p}`) : ['1. (a jornada não tem passos de tela)']),
    '',
    '## Antes de começar',
    '',
    '- Entre com o seu usuário e a sua senha de sempre; o estabelecimento ativo aparece no alto da tela.',
    '- Se algo não aparecer como no guia, chame o multiplicador do seu setor.',
    '',
    `Jornadas de origem: ${titulosDosTestes.map((x) => `“${x}”`).join('; ') || '—'}.`,
    '',
  ].join('\n');
}

/** Roteiro de vídeo de poucos minutos da tarefa: uma cena por passo, com a fala e o que mostrar. */
export function roteiroVideoMarkdown(t: TarefaTreinamento, passos: readonly string[]): string {
  const cenas = passos.length ? passos : ['(a jornada não tem passos de tela)'];
  const segundos = 15 + cenas.length * 12;
  return [
    `# Roteiro de vídeo: ${t.titulo}`,
    '',
    `Duração estimada: ${Math.ceil(segundos / 60)} min (${ROTULO_PAPEL_ONDA(t)}). Grave na versão atual da tela, com o paciente sintético da sessão de treinamento.`,
    '',
    '| Cena | O que mostrar | Fala |',
    '|---|---|---|',
    `| 0 | A página inicial do Sante SGH | “Neste vídeo: ${t.titulo.toLowerCase()}.” |`,
    ...cenas.map(
      (p, i) => `| ${i + 1} | ${celula(p.replace(/\*\*/g, ''))} | “${celula(p.replace(/\*\*/g, ''))}” |`,
    ),
    `| ${cenas.length + 1} | O resultado na tela | “Pronto. Dúvidas: o multiplicador do seu setor.” |`,
    '',
  ].join('\n');
}

/** Operação do setor no pacote de homologação. */
export interface OperacaoDoPacote {
  readonly nome: string;
  readonly estado: string;
  readonly cenarios: readonly string[];
  readonly motivo: string;
}

/** Pacote de homologação do setor (regra 6; cap-15 §15.3.1, §15.3.2). */
export function pacoteHomologacaoMarkdown(
  setor: DefinicaoSetor,
  p: {
    readonly hospital: string;
    readonly operacoes: readonly OperacaoDoPacote[];
    readonly jornadas: readonly { readonly arquivo: string; readonly titulos: readonly string[] }[];
    readonly geradoEm: string;
  },
): string {
  return [
    `# Pacote de homologação: ${setor.nome} (onda ${setor.onda})`,
    '',
    `Gerado por \`pnpm homologacao:pacote -- --setor=${setor.id}\` em ${p.geradoEm.slice(0, 10)} (ficha do M35, regra 6; cap-15 §15.3.1). Estabelecimento: \`${p.hospital}\`; o do Serrano recebe o mesmo pacote quando a cópia existir (HS-1; DP-4). Responsável pelo setor: a designar (DP-3).`,
    '',
    '## 1. Operações do setor e estado',
    '',
    ...(p.operacoes.length
      ? [
          '| Operação | Estado | Cenários de assinatura | Motivo (fora de `verde`) |',
          '|---|---|---|---|',
          ...p.operacoes.map(
            (o) => `| \`${o.nome}\` | ${o.estado} | ${o.cenarios.join(', ')} | ${celula(o.motivo) || '—'} |`,
          ),
        ]
      : ['Só leitura: nenhuma gravação; basta a conferência do chave-usuário (cap-15 §15.3.1).']),
    '',
    `Leituras do setor: ${setor.leituras.join('; ') || '—'}. Funcionalidades (chaves, todas desligadas): ${setor.recursos.map((r) => `\`${r}\``).join(', ') || '—'}.`,
    '',
    '## 2. Roteiro de conferência no outro sistema',
    '',
    'Na cópia de homologação, com o paciente sintético da sessão: o chave-usuário executa a tarefa no Sante SGH e confere ao lado:',
    '',
    '| # | O que abrir | Onde | O que deve aparecer |',
    '|---|---|---|---|',
    ...setor.roteiro.map(
      (r, i) => `| ${i + 1} | ${celula(r.abrir)} | ${celula(r.onde)} | ${celula(r.esperado)} |`,
    ),
    '',
    'Registrar a ata (quem, quando, o que conferiu, o que divergiu) nas evidências do marco dono.',
    '',
    '## 3. Jornada automática do setor',
    '',
    ...(p.jornadas.length
      ? p.jornadas.flatMap((j) => [
          `- \`${j.arquivo}\`: ${j.titulos.map((t) => `“${t}”`).join('; ') || '(nenhum teste com o trecho)'}`,
        ])
      : ['- Nenhuma: o setor não está construído (a jornada nasce com o marco).']),
    '',
    '## 4. Dúvidas de processo abertas',
    '',
    ...(setor.duvidas.length ? setor.duvidas.map((d) => `- ${d}`) : ['- Nenhuma.']),
    '',
  ].join('\n');
}
