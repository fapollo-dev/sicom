import { useState, type ReactNode } from 'react';
import { SelectField } from '../../shared/ui/SelectField';
import { RelVendasPage } from '../rel-vendas/RelVendasPage';
import { RelVendasDataPage } from '../rel-vendas-data/RelVendasDataPage';
import { RelVendasOperadorPage } from '../rel-vendas-operador/RelVendasOperadorPage';
import { RelVendasHoraPage } from '../rel-vendas-hora/RelVendasHoraPage';
import { RelFormasPgtoPage } from '../rel-formas-pgto/RelFormasPgtoPage';
import { RelCurvaAbcPage } from '../rel-curva-abc/RelCurvaAbcPage';
import { RelSemMovimentoPage } from '../rel-sem-movimento/RelSemMovimentoPage';
import { RelCanceladosPage } from '../rel-cancelados/RelCanceladosPage';
import { RelVendasDepartamentoPage } from '../rel-vendas-departamento/RelVendasDepartamentoPage';
import { RelFinalizadorasPage } from '../rel-finalizadoras/RelFinalizadorasPage';
import { RelTicketMedioPage } from '../rel-ticket-medio/RelTicketMedioPage';
import { RelVendasExtrasPage } from '../rel-vendas-extras/RelVendasExtrasPage';

/**
 * HUB de relatórios de vendas (FRMRELVENDAS) — fiel ao legado: UMA tela só, com um combo de "modelo"
 * (as variantes `ven2_*.fr3` que o form carrega). O operador escolhe o modelo e o painel de filtros +
 * grade da variante troca abaixo. Cada `Rel*Page` continua autocontida (header/filtros/gerar/exportar),
 * então o hub não reescreve nada — só orquestra a seleção.
 *
 * ESCOPO (decisão do usuário): entram só as variantes que no legado pertencem ao FRMRELVENDAS. Caixa —
 * D.R.E., Operações de Caixa e Prévia do Fornecedor são OUTROS forms no legado → continuam telas próprias.
 * O rótulo traz o(s) código(s) de relatório do legado para rastreabilidade.
 */
const MODELOS: { value: string; label: string; render: () => ReactNode }[] = [
  { value: 'vendas', label: '01 · Produtos vendidos no período', render: () => <RelVendasPage /> },
  { value: 'vendas-data', label: '02 · Vendas por data (fechamento diário)', render: () => <RelVendasDataPage /> },
  { value: 'vendas-operador', label: '06/19/25/36/46 · Vendas por operador / vendedor', render: () => <RelVendasOperadorPage /> },
  { value: 'vendas-hora', label: '07 · Vendas por hora', render: () => <RelVendasHoraPage /> },
  { value: 'formas-pgto', label: '08 · Formas de pagamento', render: () => <RelFormasPgtoPage /> },
  { value: 'curva-abc', label: '09/10/11/18 · Curva ABC / ranking por quantidade', render: () => <RelCurvaAbcPage /> },
  { value: 'sem-movimento', label: '13 · Produtos sem movimento', render: () => <RelSemMovimentoPage /> },
  { value: 'vendas-extras', label: '21/22/26/33/39 · Complementares (ticket, promoção, depto, fornecedor, hora)', render: () => <RelVendasExtrasPage /> },
  { value: 'cancelados', label: '28/30/32 · Cancelamentos e descontos do PDV', render: () => <RelCanceladosPage /> },
  { value: 'vendas-departamento', label: '38 · Vendas por data e departamento', render: () => <RelVendasDepartamentoPage /> },
  { value: 'finalizadoras', label: 'Vendas e finalizadoras', render: () => <RelFinalizadorasPage /> },
  { value: 'ticket-medio', label: 'Ticket médio', render: () => <RelTicketMedioPage /> },
];

export function RelVendasHubPage() {
  const [modelo, setModelo] = useState('vendas');
  const atual = MODELOS.find((m) => m.value === modelo) ?? MODELOS[0];

  return (
    <div className="flex flex-col">
      {/* barra do modelo — espelha o combo do FRMRELVENDAS; alinhada ao padding do painel da variante */}
      <div className="flex flex-wrap items-end gap-gp-sm p-pad-md pb-0">
        <div className="w-[30rem] max-w-full">
          <SelectField
            label="&Modelo do relatório"
            value={modelo}
            onChange={setModelo}
            options={MODELOS.map((m) => ({ value: m.value, label: m.label }))}
          />
        </div>
      </div>
      {atual.render()}
    </div>
  );
}
