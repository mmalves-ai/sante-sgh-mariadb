<script setup lang="ts">
// Cartão de uma solicitação na fila do NIR (M44, etapa 2): a prioridade, o estado com a situação de regulação
// equivalente, o paciente, a espera e o prazo, o perfil, a reserva e as ações do estado (o servidor confere de novo):
// analisar, escolher o leito (os compatíveis com o perfil e, para o supervisor, os de fora com a exceção e a senha),
// confirmar a reserva, marcar a caminho, concluir pela admissão ou pela transferência, mudar a prioridade, cancelar ou
// rejeitar com o motivo. W0-07: corrigir o perfil, os recursos e a observação, e cancelar pelo excluir (a linha fica; com a
// senha; com reserva ou transferência vinculada, o servidor recusa com a contagem e o cartão mostra o texto).
import {
  CODIGOS_PRECAUCAO,
  CODIGOS_PRIORIDADE_NIR,
  RECURSOS_LEITO_NIR,
  type SolicitacaoNir,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteMarcadores, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarReserva,
  confirmarReserva,
  corrigirSolicitacao,
  excluirSolicitacao,
  lerLeitosCompativeis,
  novaChaveNir,
  reservarLeito,
  transicionarSolicitacao,
} from '../api-nir.js';
import { acoesDaTela, destinoDaConclusao, horaCurta, tempoEscrito } from '../regras-nir.js';
import { leitoTexto } from '../regras-tela.js';
import DialogoAlteracaoNir from './DialogoAlteracaoNir.vue';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{
  solicitacao: SolicitacaoNir;
  pode: (acao: string) => boolean;
  /** Os nomes dos tipos de acomodação (do cadastro), para o perfil do pedido que restringe o tipo de leito. */
  nomesTipos?: ReadonlyMap<number, string>;
}>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const s = computed(() => props.solicitacao);

const abertoLeitos = ref(false);
const leitos = useQuery({
  queryKey: computed(() => ['nir', 'leitos', s.value.id]),
  queryFn: () => lerLeitosCompativeis(s.value.id),
  enabled: abertoLeitos,
});
const validade = ref('');
const excecao = ref('');
const senha = ref('');
const motivo = ref('');
const prioridade = ref<string>('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const acoes = computed(() => acoesDaTela(s.value));
const conclusao = computed(() => destinoDaConclusao(s.value));

async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
    motivo.value = '';
    excecao.value = '';
    senha.value = '';
    abertoLeitos.value = false;
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const transicionar = (acao: string, extra: Record<string, unknown> = {}) =>
  fazer(() =>
    transicionarSolicitacao(
      s.value.id,
      { acao, estadoVisto: s.value.estado, ...extra },
      novaChaveNir(`transicao-${acao}`),
    ),
  );
const reservar = (leito: { bloco: string; acomodacao: string; leito: string }, comExcecao = false) =>
  fazer(() =>
    reservarLeito(
      {
        solicitacao: s.value.id,
        leito,
        ...(/^\d+$/.test(validade.value.trim()) ? { validadeMin: Number(validade.value) } : {}),
        ...(comExcecao ? { excecao: excecao.value.trim(), senha: senha.value } : {}),
      },
      novaChaveNir('reservar'),
    ),
  );
// ── W0-07: corrigir e excluir ──
const finais = ['internado', 'cancelado', 'rejeitado'];
const corrigivel = computed(() => !finais.includes(s.value.estado));
const dCorrigir = ref(false);
const dExcluir = ref(false);
const refCorrigir = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const refExcluir = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const cIntensiva = ref<'sim' | 'nao'>('nao');
const cPrecaucao = ref<string>('');
const cRecursos = ref<string[]>([]);
const cObservacao = ref('');
function abrirCorrigir(): void {
  cIntensiva.value = s.value.perfil.intensiva ? 'sim' : 'nao';
  cPrecaucao.value = s.value.perfil.precaucao ?? '';
  cRecursos.value = [...s.value.recursos];
  cObservacao.value = s.value.observacao ?? '';
  dCorrigir.value = true;
}
const opcoesIntensiva = computed(() => [
  { valor: 'nao', rotulo: t('nir.fila.enfermaria') },
  { valor: 'sim', rotulo: t('nir.fila.intensiva') },
]);
const opcoesPrecaucao = computed(() => [
  { valor: '', rotulo: t('crudNir.semPrecaucao') },
  ...CODIGOS_PRECAUCAO.map((p) => ({ valor: p, rotulo: t(`nir.precaucoes.${p}`) })),
]);
const opcoesRecursos = computed(() =>
  RECURSOS_LEITO_NIR.map((r) => ({ valor: r.codigo, rotulo: t(`crudNir.recursos.${r.codigo}`) })),
);
const recursosTexto = computed(() =>
  s.value.recursos.map((r) => (t(`crudNir.recursos.${r}`) as string) || r).join(', '),
);
function corrigir(d: { motivo: string }): void {
  void refCorrigir.value?.executar(async () => {
    await corrigirSolicitacao(
      s.value.id,
      {
        versaoVista: s.value.versao,
        perfil: {
          intensiva: cIntensiva.value === 'sim',
          precaucao: cPrecaucao.value || null,
          tiposAcomodacao: [...s.value.perfil.tiposAcomodacao],
        },
        recursos: cRecursos.value,
        observacao: cObservacao.value.trim() || null,
        motivo: d.motivo,
      },
      novaChaveNir('corrigir'),
    );
    emit('mudou');
  });
}
function excluir(d: { motivo: string; senha: string }): void {
  void refExcluir.value?.executar(async () => {
    await excluirSolicitacao(s.value.id, { motivo: d.motivo, senha: d.senha }, novaChaveNir('excluir'));
    emit('mudou');
  });
}
const opcoesPrioridade = computed(() => [
  { valor: '', rotulo: t('nir.escolha') },
  ...CODIGOS_PRIORIDADE_NIR.map((p) => ({ valor: p, rotulo: t(`nir.prioridades.${p}`) })),
]);
const perfilTexto = computed(() =>
  [
    s.value.perfil.intensiva ? t('nir.fila.intensiva') : t('nir.fila.enfermaria'),
    s.value.perfil.precaucao ? t(`nir.precaucoes.${s.value.perfil.precaucao}`) : null,
    s.value.perfil.tiposAcomodacao.length > 0
      ? t('nir.fila.tipos', {
          tipos: s.value.perfil.tiposAcomodacao
            .map((k) => props.nomesTipos?.get(k) ?? `${t('nir.fila.tipo')} ${k}`)
            .join(', '),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · '),
);
</script>

<template>
  <li class="cartao-nir" :data-testid="`solicitacao-${s.id}`" :data-estado="s.estado">
    <p>
      <strong>{{ t(`nir.prioridades.${s.prioridade}`) }}</strong> · {{ t(`nir.estados.${s.estado}`) }} ·
      {{
        s.paciente.idade !== null
          ? t('nir.fila.paciente', { nome: s.paciente.nome, idade: s.paciente.idade })
          : t('nir.fila.pacienteSemIdade', { nome: s.paciente.nome })
      }}
      · {{ t(`nir.origens.${s.origem}`) }}
    </p>
    <p class="secundario">
      {{ t('nir.fila.espera', { tempo: tempoEscrito(s.minutosEspera) }) }} ·
      <strong v-if="s.prazoEstourado" data-testid="prazo-vencido">{{ t('nir.fila.prazoVencido') }}</strong>
      <template v-else>{{ t('nir.fila.prazo', { prazo: horaCurta(s.prazoEm) }) }}</template>
      · {{ t('nir.fila.perfil', { perfil: perfilTexto }) }}
    </p>
    <p v-if="s.situacaoEquivalente" class="secundario" data-testid="equivalente">
      {{ t('nir.fila.equivale', { rotulo: s.situacaoEquivalente.rotulo }) }}
      <span v-if="s.situacaoEquivalente.aConfirmar">{{ t('nir.fila.aConfirmar') }}</span>
    </p>
    <p class="secundario">{{ s.justificativa }}</p>
    <p v-if="s.recursos.length > 0 || s.observacao" class="secundario" data-testid="recursos">
      <template v-if="s.recursos.length > 0">{{
        t('crudNir.recursosPedidos', { recursos: recursosTexto })
      }}</template>
      <template v-if="s.observacao"> · {{ t('crudNir.observacaoNir', { texto: s.observacao }) }}</template>
    </p>
    <p v-if="s.reserva" data-testid="reserva">
      {{
        t(s.reserva.situacao === 'confirmada' ? 'nir.fila.reservaConfirmada' : 'nir.fila.reserva', {
          leito: leitoTexto(s.reserva.leito),
          ate: horaCurta(s.reserva.validaAte),
        })
      }}
      <span v-if="s.reserva.excecao" class="secundario">
        · {{ t('nir.fila.excecao', { motivo: s.reserva.excecao }) }}</span
      >
    </p>
    <div class="acoes">
      <SanteBotao
        v-if="acoes.includes('analisar') && pode('analisar')"
        variante="secundario"
        :rotulo="t('nir.fila.acoes.analisar')"
        :desabilitado="ocupado"
        :data-testid="`analisar-${s.id}`"
        @acionar="transicionar('analisar')"
      />
      <SanteBotao
        v-if="acoes.includes('escolherLeito') && pode('reservar')"
        variante="secundario"
        :rotulo="t('nir.fila.acoes.escolherLeito')"
        :data-testid="`escolher-${s.id}`"
        @acionar="abertoLeitos = !abertoLeitos"
      />
      <SanteBotao
        v-if="acoes.includes('confirmar') && s.reserva && pode('confirmarReserva')"
        variante="secundario"
        :rotulo="t('nir.fila.acoes.confirmar')"
        :desabilitado="ocupado"
        :data-testid="`confirmar-${s.id}`"
        @acionar="fazer(() => confirmarReserva(s.reserva!.id, novaChaveNir('confirmar')))"
      />
      <SanteBotao
        v-if="acoes.includes('transito') && pode('transito')"
        variante="secundario"
        :rotulo="t('nir.fila.acoes.transito')"
        :desabilitado="ocupado"
        :data-testid="`transito-${s.id}`"
        @acionar="transicionar('transito')"
      />
      <RouterLink
        v-if="acoes.includes('concluir') && conclusao"
        :to="conclusao"
        :data-testid="`concluir-${s.id}`"
        >{{
          s.origem === 'internado' ? t('nir.fila.acoes.transferir') : t('nir.fila.acoes.admitir')
        }}</RouterLink
      >
    </div>
    <section v-if="abertoLeitos" class="painel" :aria-label="t('nir.fila.leitos')">
      <h3>{{ t('nir.fila.leitos') }}</h3>
      <p v-if="!leitos.data.value" role="status">{{ t('nir.carregando') }}</p>
      <template v-else>
        <p>{{ t('nir.fila.leitosCompativeis', { n: leitos.data.value.compativeis }) }}</p>
        <SanteCampoTexto v-model="validade" :rotulo="t('nir.fila.validade')" :max-bytes="4" />
        <ul class="lista-simples">
          <li
            v-for="l in leitos.data.value.leitos.filter((x) => x.compativel)"
            :key="l.chave"
            :data-testid="`leito-compativel-${l.chave}`"
          >
            {{ leitoTexto(l.leito) }} · {{ l.tipo.nome }}
            <SanteBotao
              variante="secundario"
              :rotulo="t('nir.fila.reservar')"
              :desabilitado="ocupado"
              :data-testid="`reservar-${s.id}-${l.chave}`"
              @acionar="reservar(l.leito)"
            />
          </li>
        </ul>
        <details v-if="leitos.data.value.leitos.some((x) => !x.compativel)">
          <summary>{{ t('nir.fila.incompativeis') }}</summary>
          <ul class="lista-simples">
            <li v-for="l in leitos.data.value.leitos.filter((x) => !x.compativel)" :key="l.chave">
              {{ leitoTexto(l.leito) }} · {{ l.motivo }}
              <SanteBotao
                v-if="pode('excecao')"
                variante="secundario"
                :rotulo="t('nir.fila.reservarComExcecao')"
                :desabilitado="ocupado || excecao.trim().length < 10 || !senha"
                :data-testid="`reservar-excecao-${s.id}-${l.chave}`"
                @acionar="reservar(l.leito, true)"
              />
            </li>
          </ul>
          <template v-if="pode('excecao')">
            <SanteCampoTexto v-model="excecao" :rotulo="t('nir.fila.excecaoMotivo')" :max-bytes="300" />
            <SanteCampoTexto v-model="senha" :rotulo="t('nir.fila.excecaoSenha')" :max-bytes="200" />
          </template>
        </details>
      </template>
    </section>
    <details v-if="acoes.includes('priorizar') || acoes.includes('encerrar')" class="secundario">
      <summary>{{ t('nir.fila.motivo') }}</summary>
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('nir.fila.motivo')"
        :max-bytes="300"
        :id="`motivo-${s.id}`"
      />
      <SanteSelecao
        v-if="pode('priorizar')"
        v-model="prioridade"
        :rotulo="t('nir.fila.novaPrioridade')"
        :opcoes="opcoesPrioridade"
        :data-testid="`prioridade-${s.id}`"
      />
      <div class="acoes">
        <SanteBotao
          v-if="pode('priorizar')"
          variante="secundario"
          :rotulo="t('nir.fila.acoes.priorizar')"
          :desabilitado="ocupado || !prioridade || motivo.trim().length < 5"
          :data-testid="`priorizar-${s.id}`"
          @acionar="transicionar('priorizar', { prioridade, motivo: motivo.trim() })"
        />
        <SanteBotao
          v-if="s.reserva && pode('cancelarReserva')"
          variante="secundario"
          :rotulo="t('nir.fila.acoes.cancelarReserva')"
          :desabilitado="ocupado || motivo.trim().length < 5"
          :data-testid="`cancelar-reserva-${s.id}`"
          @acionar="
            fazer(() =>
              cancelarReserva(s.reserva!.id, { motivo: motivo.trim() }, novaChaveNir('cancelar-reserva')),
            )
          "
        />
        <SanteBotao
          v-if="pode('cancelar')"
          variante="destrutivo"
          :confirmacao="t('nir.fila.acoes.cancelar')"
          :rotulo="t('nir.fila.acoes.cancelar')"
          :desabilitado="ocupado || motivo.trim().length < 5"
          :data-testid="`cancelar-${s.id}`"
          @acionar="transicionar('cancelar', { motivo: motivo.trim() })"
        />
        <SanteBotao
          v-if="pode('rejeitar')"
          variante="destrutivo"
          :confirmacao="t('nir.fila.acoes.rejeitar')"
          :rotulo="t('nir.fila.acoes.rejeitar')"
          :desabilitado="ocupado || motivo.trim().length < 5"
          :data-testid="`rejeitar-${s.id}`"
          @acionar="transicionar('rejeitar', { motivo: motivo.trim() })"
        />
      </div>
    </details>
    <details v-if="s.historico.length > 0" class="secundario">
      <summary>{{ t('nir.fila.historico') }}</summary>
      <ul class="lista-simples">
        <li v-for="(h, i) in s.historico" :key="i">
          {{ horaCurta(h.em) }} · {{ t(`nir.estados.${h.para}`) }} · {{ h.por }}
          <template v-if="h.motivo"> · {{ h.motivo }}</template>
        </li>
      </ul>
    </details>
    <div v-if="corrigivel && (pode('corrigir') || pode('excluir'))" class="acoes">
      <SanteBotao
        v-if="pode('corrigir')"
        variante="texto"
        :rotulo="t('crudNir.corrigir')"
        :data-testid="`corrigir-${s.id}`"
        @acionar="abrirCorrigir"
      />
      <SanteBotao
        v-if="pode('excluir')"
        variante="texto"
        :rotulo="t('crudNir.cancelarComMotivo')"
        :data-testid="`excluir-${s.id}`"
        @acionar="dExcluir = true"
      />
    </div>
    <DialogoAlteracaoNir
      ref="refCorrigir"
      v-model:visivel="dCorrigir"
      :titulo="t('crudNir.corrigirTitulo')"
      :texto="t('crudNir.corrigirTexto')"
      :rotulo-confirmar="t('crudNir.corrigir')"
      :testid="`dialogo-corrigir-${s.id}`"
      @confirmar="corrigir"
    >
      <SanteSelecao v-model="cIntensiva" :rotulo="t('crudNir.leitoPedido')" :opcoes="opcoesIntensiva" />
      <SanteSelecao
        v-model="cPrecaucao"
        :rotulo="t('crudNir.precaucao')"
        :opcoes="opcoesPrecaucao"
        :data-testid="`corrigir-precaucao-${s.id}`"
      />
      <SanteMarcadores v-model="cRecursos" :legenda="t('crudNir.recursosLegenda')" :opcoes="opcoesRecursos" />
      <SanteCampoTexto
        v-model="cObservacao"
        :rotulo="t('crudNir.observacao')"
        :max-bytes="300"
        multilinha
        :data-testid="`corrigir-observacao-${s.id}`"
      />
    </DialogoAlteracaoNir>
    <DialogoAlteracaoNir
      ref="refExcluir"
      v-model:visivel="dExcluir"
      :titulo="t('crudNir.excluirTitulo')"
      :texto="t('crudNir.excluirTexto')"
      :rotulo-confirmar="t('crudNir.cancelarComMotivo')"
      :min-motivo="3"
      :max-motivo="500"
      destrutivo
      pede-senha
      :testid="`dialogo-excluir-${s.id}`"
      @confirmar="excluir"
    />
    <ErroAdt v-if="erro" :erro="erro" />
  </li>
</template>

<style scoped>
.cartao-nir {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
/* Alvo de toque de ao menos 24 px (WCAG 2.2, 2.5.8). */
summary {
  min-height: 2rem;
  padding-block: var(--sgh-espaco-1);
  cursor: pointer;
}
</style>
