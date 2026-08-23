-- RTB Beauty role-specific Personal Service Setting checklist model.
-- Production migration 20260812212348. Keeps preview/CI migration history aligned.

alter table public.operation_checklist_items add column if not exists scope text not null default 'shared';
alter table public.operation_checklist_runs add column if not exists scope text not null default 'shared';
alter table public.operation_checklist_items add column if not exists category text not null default 'General';
alter table public.operation_checklist_items add column if not exists audience text not null default 'all';

-- Existing Beauty station items are replaced by service-specific items.
update public.operation_checklist_items i
set active=false
from public.operation_checklist_templates t
where i.template_id=t.id
  and t.business_unit_id='f39374d8-7518-435d-9f8f-7af1cd42bff9'
  and i.scope='station';

with templates as (
  select id, checklist_type from public.operation_checklist_templates
  where business_unit_id='f39374d8-7518-435d-9f8f-7af1cd42bff9' and active
), seed(checklist_type, audience, category, sort_order, label, details, required, requires_photo) as (
 values
 ('opening','all','Station appearance',10,'Station is uncluttered, client-ready and free of visible dust, debris, hair or product residue','Keep work surfaces smooth, cleanable and sanitary.',true,false),
 ('opening','all','IPAC basics',20,'Handwashing area is accessible and stocked with soap and single-use hand drying','Required for a personal service setting.',true,false),
 ('opening','all','IPAC basics',30,'Approved disinfectant is available, in date and labelled for use','Use products with a DIN/NPN where required and follow manufacturer contact time.',true,false),
 ('opening','all','Clean / dirty separation',40,'Clean tools and supplies are stored separately from used or dirty items','Do not mix reprocessed and contaminated equipment.',true,false),
 ('opening','all','Waste',50,'Waste container is lined, accessible and not overflowing','Use appropriate waste and sharps containers where applicable.',true,false),
 ('opening','nail','Nail station',100,'Manicure table, lamp, arm rest and client-touch surfaces are clean and disinfected','Clean and disinfect work surfaces before clients.',true,false),
 ('opening','nail','Nail station',110,'Single-use nail files, buffers and similar disposable items are new and ready','Single-use items are discarded after use and not stored for reuse.',true,false),
 ('opening','pedicure','Pedicure',120,'Pedicure chair, basin and surrounding touch surfaces are clean and ready','Foot baths and basins require proper cleaning/disinfection between clients.',true,false),
 ('opening','pedicure','Pedicure',130,'Pedicure single-use items are stocked and unused','Pumice stones and other designated single-use items are not reused.',true,false),
 ('opening','lash','Lash station',200,'Lash bed, pillow cover, lamp, tweezers tray and client-touch surfaces are clean and organized','Maintain a clean, easily cleanable treatment area.',true,false),
 ('opening','lash','Lash station',210,'Clean reusable lash tools are stored protected from used tools','Keep clean equipment separate from dirty equipment.',true,false),
 ('opening','waxing','Waxing',300,'Waxing bed, trolley and client-touch surfaces are clean and disinfected','Work surfaces must be sanitary and readily cleanable.',true,false),
 ('opening','waxing','Waxing',310,'Fresh single-use applicators and strips are stocked','No double dipping; discard single-use applicators after use.',true,false),
 ('opening','facial','Facial',400,'Facial bed, trolley, bowls and client-touch surfaces are clean and disinfected','Clean/disinfect reusable equipment according to required level.',true,false),
 ('opening','facial','Facial',410,'Clean linens and single-use supplies are stocked and protected','Clean supplies should remain protected from contamination.',true,false),
 ('closing','all','Station appearance',10,'Station is reset, uncluttered and visually client-ready for the next shift','Remove product residue and visible debris.',true,false),
 ('closing','all','Reprocessing',20,'All used reusable tools have been moved to the designated reprocessing workflow','Reusable equipment must be cleaned and disinfected or sterilized as applicable after use.',true,false),
 ('closing','all','Clean / dirty separation',30,'Clean reprocessed tools are stored protected and separate from dirty items','Maintain separation through storage.',true,false),
 ('closing','all','Waste',40,'Single-use items and waste from the shift have been discarded appropriately','Do not retain single-use items for reuse.',true,false),
 ('closing','nail','Nail station',100,'Nail table, lamp, arm rest and client-touch surfaces are cleaned and disinfected','Complete end-of-shift surface cleaning.',true,false),
 ('closing','pedicure','Pedicure',120,'Pedicure basin and chair have completed the required cleaning/disinfection process','Document/report any basin or equipment issue.',true,false),
 ('closing','lash','Lash station',200,'Lash bed, lamp and trolley are cleaned and reset; reusable tools are in reprocessing/clean storage','Keep the treatment area sanitary.',true,false),
 ('closing','waxing','Waxing',300,'Wax warmer exterior, trolley and treatment surfaces are clean; used applicators are discarded','No single-use waxing applicator is retained.',true,false),
 ('closing','facial','Facial',400,'Facial bed, trolley and reusable bowls/tools are cleaned or sent to reprocessing','Reset with clean linens/supplies only.',true,false)
)
insert into public.operation_checklist_items(template_id,label,details,sort_order,requires_photo,active,scope,required,category,audience)
select t.id,s.label,s.details,s.sort_order,s.requires_photo,true,'station',s.required,s.category,s.audience
from templates t join seed s on s.checklist_type=t.checklist_type;

update public.operation_checklist_items i set category = case
  when lower(label) ~ 'reception|front door|waiting|front counter|magazine|refreshment' then 'Front & Reception'
  when lower(label) ~ 'toilet|washroom|soap|toilet paper|paper towel' then 'Washroom'
  when lower(label) ~ 'nail|pedicure|beauty lounge common|shared counter|shared mirror' then 'Beauty Floor'
  when lower(label) ~ 'restock|inventory|supply|paper product|cleaning product' then 'Restocking & Inventory'
  when lower(label) ~ 'damage|maintenance|report' then 'Issues & Maintenance'
  when lower(label) ~ 'walk through|client-ready|photo' then 'Final Walkthrough'
  else 'General Cleaning' end,
  audience='operations_cleaning'
from public.operation_checklist_templates t
where i.template_id=t.id and t.business_unit_id='f39374d8-7518-435d-9f8f-7af1cd42bff9' and i.scope='cleaning';

-- Function bodies are maintained in production by the same migration: claim_my_operation_checklist
-- resolves station audience from staff role/services and get_my_daily_operations returns item category,
-- audience and 30-day history. This marker intentionally records the seed/schema portions in source.
