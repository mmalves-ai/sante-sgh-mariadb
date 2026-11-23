<script setup lang="ts">
// Reserva de leito (ficha do M44, seção 7, etapa 2): `/internacao/nir/reservas`. As reservas vigentes com a validade
// que falta, a confirmação do setor de destino, a exceção ao perfil e o conflito (o outro sistema ocupou o leito
// reservado aqui: o NIR cancela e escolhe outro leito, nunca desfaz a ocupação); as encerradas recentes (consumidas,
// expiradas, canceladas). O leito reservado aparece no mapa de leitos como "reservado". Reserva nova: pela fila.
// W0-07: alterar o leito e a validade (só no novo) e cancelar a reserva (o excluir cancela: a linha fica), com o motivo num
// diálogo; a reserva convertida em internação recusa (o diálogo mostra o porquê).
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import {
  alterarReserva,
  excluirReserva,
  lerLeitosCompativeis,
  cancelarReserva,
  CANAL_NIR,
  confirmarReserva,
  lerGravacaoNir,
  lerReservasNir,
  novaChaveNir,
} from '../api-nir.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import DialogoAlteracaoNir from '../componentes/DialogoAlteracaoNir.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { horaCurta } from '../regras-nir.js';
import { leitoTexto } from '../regras-tela.js';

const { t } = useI18n();
const gravacao = useQuery({ queryKey: ['nir', 'gravacao'], queryFn: lerGravacaoNir, staleTime: 30_000 });
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const avisos = usarAvisosAtendimento(CANAL_NIR, () => void reservas.refetch());
const reservas = useQuery({
  queryKey: ['nir', 'reservas'],
  queryFn: lerReservasNir,
  refetchInterval: computed(() => Math.min(avisos.intervalo(), 30_000)),
});
const motivos = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
    await reservas.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-07: alterar e excluir ──
const alvo = ref<{ id: number; solicitacao: number } | null>(null);
const dAlterar = ref(false);
const dExcluir = ref(false);
const refAlterar = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const refExcluir = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const novoLeito = ref('');
const novaValidade = ref('');
const leitosAlvo = useQuery({
  queryKey: computed(() => ['nir', 'leitos', alvo.value?.solicitacao ?? 0]),
  queryFn: () => lerLeitosCompativeis(alvo.value?.solicitacao ?? 0),
  enabled: computed(() => dAlterar.value && !!alvo.value),
});
const opcoesLeito = computed(() => [
  { valor: '', rotulo: t('crudNir.mesmoLeito') },
  ...(leitosAlvo.data.value?.leitos ?? [])
    .filter((l) => l.compativel)
    .map((l) => ({ valor: l.chave, rotulo: `${leitoTexto(l.leito)} · ${l.tipo.nome}` })),
]);
function abrirAlterar(r: { id: number; solicitacao: number }): void {
  alvo.value = r;
  novoLeito.value = '';
  novaValidade.value = '';
  dAlterar.value = true;
}
function abrirExcluir(r: { id: number; solicitacao: number }): void {
  alvo.value = r;
  dExcluir.value = true;
}
function alterar(d: { motivo: string }): void {
  const r = alvo.value;
  if (!r) return;
  const leito = leitosAlvo.data.value?.leitos.find((l) => l.chave === novoLeito.value)?.leito;
  void refAlterar.value?.executar(async () => {
    await alterarReserva(
      r.id,
      {
        ...(leito ? { leito } : {}),
        ...(/^\d+$/.test(novaValidade.value.trim()) ? { validadeMin: Number(novaValidade.value) } : {}),
        motivo: d.motivo,
      },
      novaChaveNir('alterar-reserva'),
    );
    await reservas.refetch();
  });
}
function excluir(d: { motivo: string }): void {
  const r = alvo.value;
  if (!r) return;
  void refExcluir.value?.executar(async () => {
    await excluirReserva(r.id, { motivo: d.motivo }, novaChaveNir('excluir-reserva'));
    await reservas.refetch();
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nir-reservas-titulo" data-testid="tela-reservas-nir">
    <h1 id="nir-reservas-titulo">{{ t('nir.reservas.titulo') }}</h1>
    <p>{{ t('nir.reservas.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/fila">{{ t('nir.atalhos.fila') }}</RouterLink>
      <RouterLink to="/leitos/mapa">{{ t('nir.atalhos.mapa') }}</RouterLink>
    </p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="reservas.isError.value" :erro="reservas.error.value" />
    <p v-else-if="!reservas.data.value" role="status">{{ t('nir.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="nir-vigentes">
        <h2 id="nir-vigentes">{{ t('nir.reservas.vigentes') }}</h2>
        <p v-if="reservas.data.value.vigentes.length === 0">{{ t('nir.nenhum') }}</p>
        <ul v-else class="lista-simples" data-testid="reservas-vigentes">
          <li v-for="r in reservas.data.value.vigentes" :key="r.id" :data-testid="`reserva-${r.id}`">
            <strong>{{ leitoTexto(r.leito) }}</strong> · {{ t('nir.reservas.solicitacao') }}
            {{ r.solicitacao }} · {{ t(`nir.reservas.situacoes.${r.situacao}`) }} ·
            {{ t('nir.reservas.validaAte') }} {{ horaCurta(r.validaAte) }} ·
            {{
              r.minutosRestantes >= 0
                ? t('nir.reservas.restam', { n: r.minutosRestantes })
                : t('nir.reservas.vencida')
            }}
            <span v-if="r.excecao" class="secundario">
              · {{ t('nir.fila.excecao', { motivo: r.excecao }) }}</span
            >
            <strong v-if="r.conflito" class="alerta" data-testid="reserva-conflito">
              · {{ t('nir.reservas.conflito', { internacao: r.conflito.internacao }) }}</strong
            >
            <span class="acoes">
              <SanteBotao
                v-if="pode('alterarReserva')"
                variante="texto"
                :rotulo="t('crudNir.alterar')"
                :data-testid="`reserva-alterar-${r.id}`"
                @acionar="abrirAlterar(r)"
              />
              <SanteBotao
                v-if="(r.situacao === 'ativa' || r.situacao === 'confirmada') && pode('excluirReserva')"
                variante="texto"
                :rotulo="t('crudNir.cancelarComMotivo')"
                :data-testid="`reserva-excluir-${r.id}`"
                @acionar="abrirExcluir(r)"
              />
              <SanteBotao
                v-if="r.situacao === 'ativa' && pode('confirmarReserva')"
                variante="secundario"
                :rotulo="t('nir.reservas.confirmar')"
                :desabilitado="ocupado"
                :data-testid="`reserva-confirmar-${r.id}`"
                @acionar="fazer(() => confirmarReserva(r.id, novaChaveNir('confirmar')))"
              />
              <template v-if="pode('cancelarReserva')">
                <SanteCampoTexto
                  :model-value="motivos[r.id] ?? ''"
                  :rotulo="t('nir.reservas.motivo')"
                  :max-bytes="300"
                  @update:model-value="(v: string) => (motivos[r.id] = v)"
                />
                <SanteBotao
                  variante="destrutivo"
                  :confirmacao="t('nir.reservas.cancelar')"
                  :rotulo="t('nir.reservas.cancelar')"
                  :desabilitado="ocupado || (motivos[r.id] ?? '').trim().length < 5"
                  :data-testid="`reserva-cancelar-${r.id}`"
                  @acionar="
                    fazer(() =>
                      cancelarReserva(
                        r.id,
                        { motivo: (motivos[r.id] ?? '').trim() },
                        novaChaveNir('cancelar-reserva'),
                      ),
                    )
                  "
                />
              </template>
            </span>
          </li>
        </ul>
      </section>
      <section class="painel" aria-labelledby="nir-encerradas">
        <h2 id="nir-encerradas">{{ t('nir.reservas.encerradas') }}</h2>
        <p v-if="reservas.data.value.encerradas.length === 0">{{ t('nir.nenhum') }}</p>
        <ul v-else class="lista-simples" data-testid="reservas-encerradas">
          <li
            v-for="r in reservas.data.value.encerradas"
            :key="r.id"
            :data-testid="`reserva-encerrada-${r.id}`"
          >
            {{ leitoTexto(r.leito) }} · {{ t('nir.reservas.solicitacao') }} {{ r.solicitacao }} ·
            {{ t(`nir.reservas.situacoes.${r.situacao}`) }}
          </li>
        </ul>
      </section>
    </template>
    <ErroAdt v-if="erro" :erro="erro" />
    <DialogoAlteracaoNir
      ref="refAlterar"
      v-model:visivel="dAlterar"
      :titulo="t('crudNir.alterarReservaTitulo')"
      :texto="t('crudNir.alterarReservaTexto')"
      :rotulo-confirmar="t('crudNir.alterar')"
      :incompleto="!novoLeito && !/^\d+$/.test(novaValidade.trim())"
      testid="dialogo-alterar-reserva"
      @confirmar="alterar"
    >
      <SanteSelecao
        v-model="novoLeito"
        :rotulo="t('crudNir.novoLeito')"
        :opcoes="opcoesLeito"
        :busca="true"
        data-testid="alterar-reserva-leito"
      />
      <SanteCampoTexto
        v-model="novaValidade"
        :rotulo="t('crudNir.novaValidade')"
        :max-bytes="4"
        data-testid="alterar-reserva-validade"
      />
    </DialogoAlteracaoNir>
    <DialogoAlteracaoNir
      ref="refExcluir"
      v-model:visivel="dExcluir"
      :titulo="t('crudNir.excluirReservaTitulo')"
      :texto="t('crudNir.excluirReservaTexto')"
      :rotulo-confirmar="t('crudNir.cancelarComMotivo')"
      :min-motivo="3"
      :max-motivo="500"
      destrutivo
      testid="dialogo-excluir-reserva"
      @confirmar="excluir"
    />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.alerta {
  color: var(--sgh-alerta);
}
</style>
