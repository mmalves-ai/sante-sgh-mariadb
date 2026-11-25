<script setup lang="ts">
// 02-REC linha 39: contato ativo com o paciente antes da consulta. Uma tela só para a central: a fila das consultas que
// aguardam confirmação (quem disse "não" à mensagem em primeiro, depois o contato programado já devido e a consulta
// mais próxima), com o telefone à vista e o registro da tentativa na própria linha (canal e resultado; a tela diz na
// hora o que vai acontecer com a consulta). O histórico do paciente abre na mesma tela. O servidor decide de novo
// pela regra do domínio (decidirContato) e grava na mesma transação o contato e o efeito na marcação.
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

// ── Registro do contato na linha ────────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const f = reactive({ canal: 'telefone' as Canal, resultado: '', informante: '', descricao: '' });
function abrir(i: ItemFila) {
  erro.value = null;
  mensagem.value = '';
  historico.value = null;
  aberto.value = i.marcacao;
  f.canal = 'telefone';
  f.resultado = '';
  f.informante = '';
  f.descricao = '';
}
const escolhido = computed(() => resultados.data.value?.find((r) => r.codigo === f.resultado) ?? null);
/** O que a gravação fará, dito antes de gravar (e a recusa na hora). */
const previsao = computed(() => {
  const r = escolhido.value;
  if (!r) return { recusa: t('contatoAtivo.faltaResultado'), texto: '' };
  if (r.sucesso && r.efeitoMarcacao === 'cancelar' && !podeCancelar.value)
    return { recusa: t('contatoAtivo.semPermissaoCancelar'), texto: '' };
  const texto = !r.sucesso
    ? r.encerraTentativas
      ? t('contatoAtivo.efeitoNenhum')
      : t('contatoAtivo.efeitoNovaTentativa')
    : r.efeitoMarcacao === 'confirmar'
      ? t('contatoAtivo.efeitoConfirmar')
      : r.efeitoMarcacao === 'cancelar'
        ? t('contatoAtivo.efeitoCancelar')
        : t('contatoAtivo.efeitoNenhum');
  return { recusa: null, texto };
});
async function gravar(i: ItemFila) {
  if (previsao.value.recusa) return;
  erro.value = null;
  try {
    const r = await registrarContato(
      {
        paciente: i.paciente,
        marcacao: i.marcacao,
        pendente: i.contatoPendente,
        canal: f.canal,
        motivo: 'confirmacao_marcacao',
        resultado: f.resultado,
        contatoEm: new Date().toISOString(),
        informante: f.informante.trim() || null,
        descricao: f.descricao.trim() || null,
      },
      novaChave('contato-ativo'),
    );
    aberto.value = null;
    mensagem.value = [
      r.mensagem ?? '',
      r.resultado.novaTentativa ? t('contatoAtivo.novaTentativaEm') : '',
      ...(r.resultado.alertas ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    await qc.invalidateQueries({ queryKey: ['agenda-contato-ativo'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Histórico por paciente ──────────────────────────────────────────────────────────────────────────
const historico = ref<{ nome: string; contatos: ContatoLido[] } | null>(null);
async function verHistorico(paciente: number, nome: string) {
  erro.value = null;
  aberto.value = null;
  try {
    historico.value = { nome, contatos: await lerHistoricoContato(paciente) };
  } catch (e) {
    erro.value = e;
  }
}

// ── Programados fora de consulta ────────────────────────────────────────────────────────────────────
const motivos = reactive<Record<number, string>>({});
async function cancelarProgramado(c: ContatoLido) {
  const motivo = (motivos[c.id] ?? '').trim();
  if (motivo.length < 3) return;
  erro.value = null;
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
                  v-if="podeRegistrar && aberto !== i.marcacao"
                  :rotulo="t('contatoAtivo.registrar')"
                  :data-testid="`contato-registrar-${i.marcacao}`"
                  @acionar="abrir(i)"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('contatoAtivo.historico')"
                  :data-testid="`contato-historico-${i.marcacao}`"
                  @acionar="verHistorico(i.paciente, i.nome)"
                />
              </td>
            </tr>
            <tr v-if="aberto === i.marcacao">
              <td colspan="6">
                <section
                  class="painel"
                  :aria-label="t('contatoAtivo.registrar')"
                  data-testid="contato-edicao"
                >
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
                  <p v-if="previsao.recusa" role="alert" data-testid="contato-recusa">
                    {{ previsao.recusa }}
                  </p>
                  <p v-else data-testid="contato-previsao">{{ previsao.texto }}</p>
                  <div class="acoes">
                    <SanteBotao
                      :rotulo="t('contatoAtivo.gravar')"
                      :desabilitado="previsao.recusa !== null"
                      data-testid="contato-gravar"
                      @acionar="gravar(i)"
                    />
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('contatoAtivo.fechar')"
                      @acionar="aberto = null"
                    />
                  </div>
                </section>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <h2>{{ t('contatoAtivo.programados') }}</h2>
      <p v-if="fila.data.value.programados.length === 0">{{ t('contatoAtivo.semProgramados') }}</p>
      <ul v-else data-testid="contato-programados">
        <li v-for="c in fila.data.value.programados" :key="c.id" :data-testid="`contato-programado-${c.id}`">
          {{ c.nome }} · {{ t(`contatoAtivo.canais.${c.canal}`) }} · {{ dataHora(c.programadoPara) }}
          <template v-if="podeRegistrar">
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
      <SanteBotao variante="secundario" :rotulo="t('contatoAtivo.fechar')" @acionar="historico = null" />
    </section>

    <p v-if="mensagem" role="status" data-testid="contato-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro || fila.error.value" :erro="erro ?? fila.error.value" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
