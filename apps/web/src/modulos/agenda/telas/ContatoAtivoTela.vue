<script setup lang="ts">
// 02-REC linha 39: contato ativo com o paciente antes da consulta. Uma tela só para a central: a fila das consultas que
// aguardam confirmação (quem disse "não" à mensagem em primeiro, depois o contato programado já devido e a consulta
// mais próxima), com o telefone à vista e o registro da tentativa na própria linha (canal e resultado; a tela diz na
// hora o que vai acontecer com a consulta). O histórico do paciente abre na mesma tela. O servidor decide de novo
// pela regra do domínio (decidirContato) e grava na mesma transação o contato e o efeito na marcação.
// Programar: da linha da consulta (lembrete) ou do histórico do paciente (busca ativa, resultado de exame,
// acompanhamento…), validado na hora pela mesma regra do servidor (validarProgramacaoContato). Os programados fora de
// consulta, e os que ficaram de consulta já encerrada, são feitos ou cancelados na própria lista. A desistência que
// devolve a vaga avisa quantos pedidos da lista de espera servem ao horário, com o atalho para ofertar.
import { MOTIVOS_CONTATO, validarProgramacaoContato } from '@sgh/dominio-agenda';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { novaChave } from '../api-agenda.js';
import {
  CANAIS,
  type Canal,
  cancelarContatoProgramado,
  type ContatoLido,
  type ItemFila,
  lerFilaContato,
  lerHistoricoContato,
  lerResultadosContato,
  programarContato,
  registrarContato,
} from '../api-contato-ativo.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';

const { t } = useI18n();
const qc = useQueryClient();
const podeRegistrar = computed(() => podePermissao('agenda.marcacao.confirmar'));
const podeCancelar = computed(() => podePermissao('agenda.marcacao.cancelar'));
const dias = ref('3');
const fila = useQuery({
  queryKey: computed(() => ['agenda-contato-ativo', dias.value]),
  queryFn: () => lerFilaContato(Number(dias.value)),
});
const resultados = useQuery({ queryKey: ['agenda-contato-ativo-resultados'], queryFn: lerResultadosContato });
const erro = ref<unknown>(null);
const mensagem = ref('');
/** Vaga liberada pela desistência: pedidos da lista de espera que servem ao horário (nulo: nenhuma vaga liberada). */
const espera = ref<number | null>(null);

const opcoesDias = computed(() =>
  [1, 3, 7].map((n) => ({ valor: String(n), rotulo: t('contatoAtivo.dias', { n }, n) })),
);
const opcoesCanal = computed(() => CANAIS.map((c) => ({ valor: c, rotulo: t(`contatoAtivo.canais.${c}`) })));
const opcoesResultado = computed(() => [
  { valor: '', rotulo: t('contatoAtivo.escolha') },
  ...(resultados.data.value ?? []).map((r) => ({ valor: r.codigo, rotulo: r.descricao })),
]);
const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// ── Registro do contato (da fila ou de um programado) ───────────────────────────────────────────────
interface AlvoRegistro {
  chave: string;
  paciente: number;
  nome: string;
  marcacao: number | null;
  pendente: number | null;
  motivo: string;
  /** Pendente de consulta já encerrada: só registra, não confirma nem cancela. */
  encerrada: boolean;
}
const alvo = ref<AlvoRegistro | null>(null);
const f = reactive({ canal: 'telefone' as Canal, resultado: '', informante: '', descricao: '' });
function limparAvisos() {
  erro.value = null;
  mensagem.value = '';
  espera.value = null;
}
function abrirRegistro(a: AlvoRegistro, canal: Canal = 'telefone') {
  limparAvisos();
  historico.value = null;
  programacao.value = null;
  alvo.value = a;
  f.canal = canal;
  f.resultado = '';
  f.informante = '';
  f.descricao = '';
}
const abrir = (i: ItemFila) =>
  abrirRegistro({
    chave: `m-${i.marcacao}`,
    paciente: i.paciente,
    nome: i.nome,
    marcacao: i.marcacao,
    pendente: i.contatoPendente,
    motivo: 'confirmacao_marcacao',
    encerrada: false,
  });
const abrirProgramado = (c: ContatoLido) =>
  abrirRegistro(
    {
      chave: `p-${c.id}`,
      paciente: c.paciente,
      nome: c.nome,
      marcacao: c.marcacao,
      pendente: c.id,
      motivo: c.motivo,
      encerrada: c.marcacaoEncerrada,
    },
    (CANAIS as readonly string[]).includes(c.canal) ? (c.canal as Canal) : 'telefone',
  );
const escolhido = computed(() => resultados.data.value?.find((r) => r.codigo === f.resultado) ?? null);
/** O que a gravação fará, dito antes de gravar (e a recusa na hora). */
const previsao = computed(() => {
  const r = escolhido.value;
  if (!r) return { recusa: t('contatoAtivo.faltaResultado'), texto: '' };
  const efeito = r.sucesso ? r.efeitoMarcacao : null;
  if (efeito && alvo.value?.marcacao === null)
    return { recusa: t('contatoAtivo.efeitoSemConsulta'), texto: '' };
  if (efeito && alvo.value?.encerrada) return { recusa: t('contatoAtivo.marcacaoEncerrada'), texto: '' };
  if (efeito === 'cancelar' && !podeCancelar.value)
    return { recusa: t('contatoAtivo.semPermissaoCancelar'), texto: '' };
  const texto = !r.sucesso
    ? r.encerraTentativas
      ? t('contatoAtivo.efeitoNenhum')
      : t('contatoAtivo.efeitoNovaTentativa')
    : efeito === 'confirmar'
      ? t('contatoAtivo.efeitoConfirmar')
      : efeito === 'cancelar'
        ? t('contatoAtivo.efeitoCancelar')
        : t('contatoAtivo.efeitoNenhum');
  return { recusa: null, texto };
});
async function gravar() {
  const a = alvo.value;
  if (!a || previsao.value.recusa) return;
  erro.value = null;
  try {
    const r = await registrarContato(
      {
        paciente: a.paciente,
        marcacao: a.marcacao,
        pendente: a.pendente,
        canal: f.canal,
        motivo: a.motivo,
        resultado: f.resultado,
        contatoEm: new Date().toISOString(),
        informante: f.informante.trim() || null,
        descricao: f.descricao.trim() || null,
      },
      novaChave('contato-ativo'),
    );
    alvo.value = null;
    const encerrados = r.resultado.pendentesEncerrados ?? 0;
    mensagem.value = [
      r.mensagem ?? '',
      r.resultado.novaTentativa ? t('contatoAtivo.novaTentativaEm') : '',
      encerrados > 0 ? t('contatoAtivo.pendentesEncerrados', { n: encerrados }, encerrados) : '',
      ...(r.resultado.alertas ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    espera.value = r.resultado.esperaCompativel ?? null;
    await qc.invalidateQueries({ queryKey: ['agenda-contato-ativo'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Programação de contato (da consulta ou do paciente) ─────────────────────────────────────────────
interface AlvoProgramacao {
  paciente: number;
  nome: string;
  /** A consulta da linha, quando a programação parte da fila. */
  consulta: { id: number; rotulo: string; inicioEm: string } | null;
}
const programacao = ref<AlvoProgramacao | null>(null);
const pf = reactive({ marcacao: '', canal: 'telefone' as Canal, motivo: '', quando: '', assunto: '' });
/** Data e hora local no formato do campo (AAAA-MM-DDTHH:MM). */
function paraCampo(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
function abrirProgramacao(a: AlvoProgramacao) {
  limparAvisos();
  alvo.value = null;
  programacao.value = a;
  pf.marcacao = a.consulta ? String(a.consulta.id) : '';
  pf.canal = 'telefone';
  pf.motivo = a.consulta ? 'lembrete' : 'busca_ativa';
  pf.quando = paraCampo(new Date(Date.now() + 3_600_000));
  pf.assunto = '';
}
const opcoesConsulta = computed(() => [
  { valor: '', rotulo: t('contatoAtivo.semConsulta') },
  ...(programacao.value?.consulta
    ? [{ valor: String(programacao.value.consulta.id), rotulo: programacao.value.consulta.rotulo }]
    : []),
]);
const opcoesMotivo = computed(() =>
  MOTIVOS_CONTATO.map((m) => ({ valor: m, rotulo: t(`contatoAtivo.motivos.${m}`) })),
);
/** A mesma regra do servidor, na hora (a consulta da fila sempre aguarda confirmação). */
const recusaProgramacao = computed(() => {
  const c = programacao.value?.consulta ?? null;
  return validarProgramacaoContato({
    canal: pf.canal,
    motivo: pf.motivo,
    programadoPara: new Date(pf.quando),
    agora: new Date(),
    marcacao: pf.marcacao && c ? { significado: 'aguardando', inicioEm: new Date(c.inicioEm) } : null,
  });
});
async function gravarProgramacao() {
  const a = programacao.value;
  if (!a || recusaProgramacao.value) return;
  erro.value = null;
  try {
    const r = await programarContato(
      {
        paciente: a.paciente,
        marcacao: pf.marcacao ? Number(pf.marcacao) : null,
        canal: pf.canal,
        motivo: pf.motivo,
        programadoPara: new Date(pf.quando).toISOString(),
        assunto: pf.assunto.trim() || null,
      },
      novaChave('contato-ativo-programar'),
    );
    programacao.value = null;
    mensagem.value = r.mensagem ?? '';
    await qc.invalidateQueries({ queryKey: ['agenda-contato-ativo'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Histórico por paciente ──────────────────────────────────────────────────────────────────────────
const historico = ref<{ paciente: number; nome: string; contatos: ContatoLido[] } | null>(null);
async function verHistorico(paciente: number, nome: string) {
  erro.value = null;
  alvo.value = null;
  programacao.value = null;
  try {
    historico.value = { paciente, nome, contatos: await lerHistoricoContato(paciente) };
  } catch (e) {
    erro.value = e;
  }
}

// ── Programados fora de consulta ────────────────────────────────────────────────────────────────────
const motivos = reactive<Record<number, string>>({});
async function cancelarProgramado(c: ContatoLido) {
  const motivo = (motivos[c.id] ?? '').trim();
  if (motivo.length < 3) return;
  limparAvisos();
  try {
    const r = await cancelarContatoProgramado(c.id, motivo, novaChave('contato-ativo-cancelar'));
    mensagem.value = r.mensagem ?? '';
    await qc.invalidateQueries({ queryKey: ['agenda-contato-ativo'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="contato-ativo-titulo" data-testid="contato-ativo">
    <h1 id="contato-ativo-titulo">{{ t('contatoAtivo.titulo') }}</h1>
    <p>{{ t('contatoAtivo.explicacao') }}</p>
    <p>{{ t('contatoAtivo.negativaNaoCancela') }}</p>
    <div class="filtros">
      <SanteSelecao
        id="contato-dias"
        v-model="dias"
        :rotulo="t('contatoAtivo.horizonte')"
        :opcoes="opcoesDias"
        data-testid="contato-dias"
      />
    </div>
    <p v-if="fila.isPending.value">{{ t('contatoAtivo.carregando') }}</p>
    <template v-else-if="fila.data.value">
      <p v-if="fila.data.value.itens.length === 0" data-testid="contato-fila-vazia">
        {{ t('contatoAtivo.vazia') }}
      </p>
      <table v-else class="tabela" data-testid="contato-fila">
        <thead>
          <tr>
            <th scope="col">{{ t('contatoAtivo.paciente') }}</th>
            <th scope="col">{{ t('contatoAtivo.telefone') }}</th>
            <th scope="col">{{ t('contatoAtivo.consulta') }}</th>
            <th scope="col">{{ t('contatoAtivo.tentativas') }}</th>
            <th scope="col">{{ t('contatoAtivo.proximo') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('contatoAtivo.registrar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="i in fila.data.value.itens" :key="i.marcacao">
            <tr :data-testid="`contato-item-${i.marcacao}`">
              <td>
                {{ i.nome }}
                <span v-if="i.prontuario"> ({{ t('contatoAtivo.prontuario') }} {{ i.prontuario }})</span>
                <strong v-if="i.respostaNegativa" :data-testid="`contato-negativa-${i.marcacao}`">
                  {{ t('contatoAtivo.respostaNegativa') }}
                </strong>
              </td>
              <td>{{ i.telefone ?? '' }}</td>
              <td>{{ i.agenda }} · {{ dataHora(i.inicioEm) }}</td>
              <td>{{ i.tentativas }}</td>
              <td>{{ dataHora(i.programadoPara) }}</td>
              <td class="acoes">
                <SanteBotao
                  v-if="podeRegistrar && alvo?.chave !== `m-${i.marcacao}`"
                  :rotulo="t('contatoAtivo.registrar')"
                  :data-testid="`contato-registrar-${i.marcacao}`"
                  @acionar="abrir(i)"
                />
                <SanteBotao
                  v-if="podeRegistrar"
                  variante="secundario"
                  :rotulo="t('contatoAtivo.programar')"
                  :data-testid="`contato-programar-${i.marcacao}`"
                  @acionar="
                    abrirProgramacao({
                      paciente: i.paciente,
                      nome: i.nome,
                      consulta: {
                        id: i.marcacao,
                        rotulo: `${i.agenda} · ${dataHora(i.inicioEm)}`,
                        inicioEm: i.inicioEm,
                      },
                    })
                  "
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('contatoAtivo.historico')"
                  :data-testid="`contato-historico-${i.marcacao}`"
                  @acionar="verHistorico(i.paciente, i.nome)"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <h2>{{ t('contatoAtivo.programados') }}</h2>
      <p v-if="fila.data.value.programados.length === 0">{{ t('contatoAtivo.semProgramados') }}</p>
      <ul v-else data-testid="contato-programados">
        <li v-for="c in fila.data.value.programados" :key="c.id" :data-testid="`contato-programado-${c.id}`">
          {{ c.nome }} · {{ t(`contatoAtivo.motivos.${c.motivo}`) }} ·
          {{ t(`contatoAtivo.canais.${c.canal}`) }} ·
          {{ dataHora(c.programadoPara) }}
          <strong v-if="c.marcacaoEncerrada" :data-testid="`contato-orfao-${c.id}`">
            {{ t('contatoAtivo.marcacaoEncerrada') }}
          </strong>
          <template v-if="podeRegistrar">
            <SanteBotao
              v-if="alvo?.chave !== `p-${c.id}`"
              :rotulo="t('contatoAtivo.registrar')"
              :data-testid="`contato-programado-registrar-${c.id}`"
              @acionar="abrirProgramado(c)"
            />
            <SanteCampoTexto
              :model-value="motivos[c.id] ?? ''"
              @update:model-value="(v: string) => (motivos[c.id] = v)"
              :rotulo="t('contatoAtivo.motivoCancelamento')"
              :max-bytes="500"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('contatoAtivo.cancelarProgramado')"
              :desabilitado="(motivos[c.id] ?? '').trim().length < 3"
              @acionar="cancelarProgramado(c)"
            />
          </template>
        </li>
      </ul>
    </template>

    <section
      v-if="alvo"
      class="painel"
      :aria-label="t('contatoAtivo.registrar')"
      data-testid="contato-edicao"
    >
      <h2>{{ t('contatoAtivo.registrarPara', { nome: alvo.nome }) }}</h2>
      <p>{{ t(`contatoAtivo.motivos.${alvo.motivo}`) }}</p>
      <div class="filtros">
        <SanteSelecao
          id="contato-canal"
          v-model="f.canal"
          :rotulo="t('contatoAtivo.canal')"
          :opcoes="opcoesCanal"
        />
        <SanteSelecao
          id="contato-resultado"
          v-model="f.resultado"
          :rotulo="t('contatoAtivo.resultado')"
          :opcoes="opcoesResultado"
        />
        <SanteCampoTexto
          v-model="f.informante"
          :rotulo="t('contatoAtivo.informante')"
          :max-bytes="150"
          data-testid="contato-informante"
        />
        <SanteCampoTexto
          v-model="f.descricao"
          :rotulo="t('contatoAtivo.descricao')"
          :max-bytes="2000"
          data-testid="contato-descricao"
        />
      </div>
      <p v-if="previsao.recusa" role="alert" data-testid="contato-recusa">{{ previsao.recusa }}</p>
      <p v-else data-testid="contato-previsao">{{ previsao.texto }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contatoAtivo.gravar')"
          :desabilitado="previsao.recusa !== null"
          data-testid="contato-gravar"
          @acionar="gravar"
        />
        <SanteBotao variante="secundario" :rotulo="t('contatoAtivo.fechar')" @acionar="alvo = null" />
      </div>
    </section>

    <section
      v-if="programacao"
      class="painel"
      :aria-label="t('contatoAtivo.programar')"
      data-testid="contato-programacao"
    >
      <h2>{{ t('contatoAtivo.programarPara2', { nome: programacao.nome }) }}</h2>
      <div class="filtros">
        <SanteSelecao
          id="programar-consulta"
          v-model="pf.marcacao"
          :rotulo="t('contatoAtivo.consultaDoContato')"
          :opcoes="opcoesConsulta"
        />
        <SanteSelecao
          id="programar-motivo"
          v-model="pf.motivo"
          :rotulo="t('contatoAtivo.motivo')"
          :opcoes="opcoesMotivo"
        />
        <SanteSelecao
          id="programar-canal"
          v-model="pf.canal"
          :rotulo="t('contatoAtivo.canal')"
          :opcoes="opcoesCanal"
        />
        <span class="campo">
          <label for="programar-quando">{{ t('contatoAtivo.programarPara') }}</label>
          <input
            id="programar-quando"
            v-model="pf.quando"
            type="datetime-local"
            data-testid="programar-quando"
          />
        </span>
        <SanteCampoTexto
          v-model="pf.assunto"
          :rotulo="t('contatoAtivo.assunto')"
          :max-bytes="500"
          data-testid="programar-assunto"
        />
      </div>
      <p v-if="recusaProgramacao" role="alert" data-testid="programar-recusa">{{ recusaProgramacao }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contatoAtivo.gravarProgramacao')"
          :desabilitado="recusaProgramacao !== null"
          data-testid="programar-gravar"
          @acionar="gravarProgramacao"
        />
        <SanteBotao variante="secundario" :rotulo="t('contatoAtivo.fechar')" @acionar="programacao = null" />
      </div>
    </section>

    <section
      v-if="historico"
      class="painel"
      :aria-label="t('contatoAtivo.historico')"
      data-testid="contato-historico"
    >
      <h2>{{ t('contatoAtivo.historico') }}: {{ historico.nome }}</h2>
      <p v-if="historico.contatos.length === 0">{{ t('contatoAtivo.historicoVazio') }}</p>
      <ul v-else>
        <li v-for="c in historico.contatos" :key="c.id">
          {{ dataHora(c.contatoEm ?? c.programadoPara) }} · {{ t(`contatoAtivo.canais.${c.canal}`) }} ·
          {{ t(`contatoAtivo.situacoes.${c.situacao}`) }}
          <span v-if="c.resultado"> · {{ c.resultado }}</span>
          <span v-if="c.descricao"> · {{ c.descricao }}</span>
        </li>
      </ul>
      <div class="acoes">
        <SanteBotao
          v-if="podeRegistrar"
          :rotulo="t('contatoAtivo.programar')"
          data-testid="contato-historico-programar"
          @acionar="abrirProgramacao({ paciente: historico.paciente, nome: historico.nome, consulta: null })"
        />
        <SanteBotao variante="secundario" :rotulo="t('contatoAtivo.fechar')" @acionar="historico = null" />
      </div>
    </section>

    <p v-if="mensagem" role="status" data-testid="contato-mensagem">{{ mensagem }}</p>
    <p v-if="espera !== null" data-testid="contato-espera">
      {{
        espera > 0
          ? t('contatoAtivo.esperaCompativel', { n: espera }, espera)
          : t('contatoAtivo.esperaNenhum')
      }}
      <RouterLink v-if="espera > 0" to="/agenda/espera">{{ t('contatoAtivo.abrirEspera') }}</RouterLink>
    </p>
    <ErroAgenda v-if="erro || fila.error.value" :erro="erro ?? fila.error.value" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
